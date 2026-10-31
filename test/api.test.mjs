import test from "node:test"; import assert from "node:assert/strict";
import { handleApi, responsesText, imageOk, cleanColour } from "../worker/api.js";
import { checkStoreUrl, buildVestireProduct, sendToVestire } from "../src/lib/vestire.js";

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const KEY = { MODEL_API_KEY: "LLM_test_key_123456" };
const req = (path, body, method = "POST") => new Request("https://x.test" + path, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
function mockFetch(handler) { const calls = []; const f = async (url, init) => { calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null }); return handler(url, init, calls.length); }; f.calls = calls; return f; }
const jres = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json", ...headers } });

test("config reports demo mode without a key, live with one", async () => {
  assert.equal((await (await handleApi(req("/api/config", null, "GET"), {})).json()).live, false);
  const c = await (await handleApi(req("/api/config", null, "GET"), KEY)).json();
  assert.equal(c.live, true); assert.deepEqual(c.models, { sam: "sam-3.1", spark: "muse-spark-1.3", image: "muse-image-1.0" });
});

test("model routes refuse without key (503) and never call upstream", async () => {
  const f = mockFetch(() => jres({}));
  const r = await handleApi(req("/api/segment", { image: IMG, prompt: "shirt" }), {}, { fetchImpl: f });
  assert.equal(r.status, 503); assert.equal(f.calls.length, 0);
});

test("segment: posts sam-3.1 to /responses with bearer key, one_bit masks, returns output_text", async () => {
  const f = mockFetch(() => jres({ output: [{ type: "message", content: [{ type: "output_text", text: "<0f>0<|box;...|>" }] }] }));
  const r = await handleApi(req("/api/segment", { image: IMG, prompt: "Polo Shirt" }), KEY, { fetchImpl: f });
  const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.text, "<0f>0<|box;...|>"); assert.equal(d.prompt, "polo shirt");
  const c = f.calls[0];
  assert.equal(c.url, "https://api.meta.ai/v1/responses"); assert.equal(c.init.headers.Authorization, "Bearer LLM_test_key_123456");
  assert.equal(c.body.model, "sam-3.1"); assert.equal(c.body.metadata.mask_encoding, "one_bit");
  assert.equal(c.body.input[0].content[0].text, "polo shirt"); assert.equal(c.body.input[0].content[1].image_url, IMG);
  assert.ok(!JSON.stringify(d).includes("LLM_test"));
});

test("listing: muse-spark chat completions → normalised listing; bad JSON → 502", async () => {
  const good = mockFetch(() => jres({ choices: [{ message: { content: '```json\n{"title":"Blue Shirt","category":"men","product_type":"Shirts","hashtags":["pk"],"price_suggestion_pkr":{"min":2000,"max":3000,"note":"s"}}\n```' } }] }));
  const r = await handleApi(req("/api/listing", { image: IMG }), KEY, { fetchImpl: good });
  const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.listing.title, "Blue Shirt"); assert.deepEqual(d.listing.hashtags, ["#pk"]);
  assert.equal(good.calls[0].url, "https://api.meta.ai/v1/chat/completions"); assert.equal(good.calls[0].body.model, "muse-spark-1.3");
  assert.equal(good.calls[0].body.reasoning_effort, "low");
  const bad = mockFetch(() => jres({ choices: [{ message: { content: "sorry" } }] }));
  assert.equal((await handleApi(req("/api/listing", { image: IMG }), KEY, { fetchImpl: bad })).status, 502);
});

test("image: muse-image edits JSON body, streams upstream body through", async () => {
  const f = mockFetch(() => jres({ data: [{ b64_json: "QUJD" }], output_format: "jpeg" }));
  const r = await handleApi(req("/api/image", { image: IMG, kind: "variant", colour: "Navy<script>" }), KEY, { fetchImpl: f });
  assert.equal(r.status, 200); assert.equal((await r.json()).data[0].b64_json, "QUJD");
  const b = f.calls[0].body;
  assert.equal(f.calls[0].url, "https://api.meta.ai/v1/images/edits"); assert.equal(b.model, "muse-image-1.0");
  assert.deepEqual(b.images, [{ image_url: IMG }]); assert.match(b.prompt, /recoloured to navyscript/);
  assert.equal((await handleApi(req("/api/image", { image: IMG, kind: "nope" }), KEY, { fetchImpl: f })).status, 400);
});

test("upstream errors are mapped, rate limits stay 429", async () => {
  const f = mockFetch(() => jres({ error: { message: "slow down" } }, 429));
  const r = await handleApi(req("/api/segment", { image: IMG }), KEY, { fetchImpl: f });
  assert.equal(r.status, 429); assert.match((await r.json()).error, /slow down/);
});

test("input validation", async () => {
  assert.equal((await handleApi(req("/api/segment", { image: "http://evil/x.png" }), KEY)).status, 400);
  assert.equal((await handleApi(req("/api/segment", { image: "data:image/jpeg;base64," + "A".repeat(3_100_000) }), KEY)).status, 400);
  assert.equal((await handleApi(new Request("https://x.test/api/segment", { method: "POST", body: "{bad" }), KEY)).status, 400);
  assert.equal((await handleApi(req("/api/unknown", {}), KEY)).status, 404);
  assert.equal(imageOk(IMG), true); assert.equal(cleanColour("  Olive GREEN!! "), "olive green"); assert.equal(cleanColour(""), "navy blue");
  assert.equal(responsesText({ output_text: "t" }), "t");
});

test("vestire: URL guard, hidden product, login → upload → save with bearer", async () => {
  assert.throws(() => checkStoreUrl("http://shop.pk"), /https/); assert.throws(() => checkStoreUrl("https://127.0.0.1"), /public/);
  assert.equal(checkStoreUrl("https://vestire-collection.pages.dev/admin"), "https://vestire-collection.pages.dev");
  const L = { title: "Blue Shirt", category: "men", product_type: "Shirts", colours: ["Blue"], description_en: "d", size_chart: { rows: [["M"], ["L"]] } };
  assert.throws(() => buildVestireProduct(L, {}), /price/i);
  const p = buildVestireProduct(L, { price: 2500 });
  assert.equal(p.active, false); assert.equal(p.brand, ""); assert.deepEqual(p.variants.map((v) => v.size), ["M", "L"]);
  const f = mockFetch((url) => {
    if (url.includes("a=login")) return jres({ id: 1 }, 200, { "Set-Cookie": "vc_admin=tok.sig; Path=/; HttpOnly" });
    if (url.includes("a=image_upload")) return jres({ id: 77 });
    return jres({ id: 9, sku: "VC-00009", active: false });
  });
  const out = await sendToVestire({ storeUrl: "https://shop.example", username: "u", password: "p", listing: L, price: 2500, images: [IMG, "not-an-image"] }, { fetchImpl: f });
  assert.deepEqual(out, { id: 9, sku: "VC-00009", active: false, images: 1, adminUrl: "https://shop.example/admin/" });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].init.headers.Authorization, "Bearer tok.sig");
  assert.equal(f.calls[2].body.active, false); assert.deepEqual(f.calls[2].body.image_ids, [77]);
});

test("vestire route: needs credentials, can be switched off", async () => {
  assert.equal((await handleApi(req("/api/vestire", { storeUrl: "https://a.b" }), {})).status, 400);
  assert.equal((await handleApi(req("/api/vestire", { storeUrl: "https://a.b", username: "u", password: "p" }), { VESTIRE_SEND: "off" })).status, 403);
});

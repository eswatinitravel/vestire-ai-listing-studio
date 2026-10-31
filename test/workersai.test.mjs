import test from "node:test"; import assert from "node:assert/strict";
import { handleApi, provider, WAI } from "../worker/api.js";
const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const req = (path, body) => new Request("https://x.test" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const LJ = { title: "Blue Shirt", category: "men", product_type: "Shirts", hashtags: ["pk"], price_suggestion_pkr: { min: 2000, max: 3000, note: "s" } };
const ai = (fn) => { const calls = []; return { calls, run: async (model, input) => { calls.push({ model, input }); return fn(model, input, calls.length); } }; };

test("provider: Meta key wins, else Workers AI binding, else demo", () => {
  assert.equal(provider({}), "demo"); assert.equal(provider({ AI: ai(() => ({})) }), "workers-ai");
  assert.equal(provider({ AI: ai(() => ({})), MODEL_API_KEY: "LLM_xxxxxxxxxxxx" }), "meta-api");
});
test("config advertises open-weight models when only the AI binding exists", async () => {
  const c = await (await handleApi(new Request("https://x.test/api/config"), { AI: ai(() => ({})) })).json();
  assert.equal(c.live, true); assert.equal(c.provider, "workers-ai"); assert.equal(c.models.scout, "@cf/meta/llama-4-scout-17b-16e-instruct");
});
test("listing via Llama 4 Scout: image part + json_schema; object response accepted", async () => {
  const A = ai(() => ({ response: LJ, usage: { neurons: 50 } }));
  const r = await handleApi(req("/api/listing", { image: IMG, hint: "M, L" }), { AI: A }); const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.model, WAI.scout); assert.equal(d.listing.title, "Blue Shirt");
  const inp = A.calls[0].input; assert.equal(A.calls[0].model, WAI.scout);
  assert.equal(inp.response_format.type, "json_schema"); assert.equal(inp.messages[1].content[1].image_url.url, IMG);
});
test("JSON-mode error retries Scout without schema; string output parsed", async () => {
  const A = ai((m, input) => { if (input.response_format) throw new Error("schema too big"); return { response: "```json\n" + JSON.stringify(LJ) + "\n```" }; });
  const d = await (await handleApi(req("/api/listing", { image: IMG }), { AI: A })).json();
  assert.equal(d.listing.title, "Blue Shirt"); assert.match(d.note, /json-mode fallback/); assert.equal(A.calls.length, 2);
});
test("Scout failure falls back to Llama 3.2 Vision with the 'agree' licence prompt", async () => {
  const A = ai((m, input) => { if (m === WAI.scout) throw new Error("capacity"); if (input.prompt === "agree") return { response: "ok" }; return { response: JSON.stringify(LJ) }; });
  const d = await (await handleApi(req("/api/listing", { image: IMG }), { AI: A })).json();
  assert.equal(d.model, WAI.vision32); assert.ok(A.calls.some((c) => c.input.prompt === "agree"));
  const last = A.calls.at(-1).input; assert.ok(Array.isArray(last.image) && last.image.length > 0);
});
test("all models failing → 502 with reasons", async () => {
  const r = await handleApi(req("/api/listing", { image: IMG }), { AI: ai(() => { throw new Error("down"); }) });
  assert.equal(r.status, 502); assert.match((await r.json()).error, /down/);
});
test("scene background via FLUX.1 schnell; unknown scene → marble", async () => {
  const A = ai(() => ({ image: "QUJD" }));
  const d = await (await handleApi(req("/api/scene", { scene: "hack" }), { AI: A })).json();
  assert.equal(d.scene, "marble"); assert.equal(d.image, "data:image/jpeg;base64,QUJD"); assert.equal(A.calls[0].model, WAI.flux);
  assert.deepEqual(Object.keys(A.calls[0].input).sort(), ["prompt", "steps"]);
});
test("segment/image routes still require the Meta key in Workers AI mode", async () => {
  assert.equal((await handleApi(req("/api/segment", { image: IMG }), { AI: ai(() => ({})) })).status, 503);
});

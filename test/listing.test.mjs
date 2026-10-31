import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { extractJson, normalizeListing, findRiskyClaims, buildListingRequest, chatContent, LISTING_SCHEMA } from "../src/lib/listing.js";
const sample = JSON.parse(fs.readFileSync(new URL("../public/demo/listing-sample.json", import.meta.url), "utf8"));

test("extractJson handles plain, fenced, prose-wrapped and <think> outputs", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Here you go: {"a":{"b":"x}y"}} thanks'), { a: { b: "x}y" } });
  assert.deepEqual(extractJson('<think>{"no":1}</think>{"a":3}'), { a: 3 });
  assert.deepEqual(extractJson({ a: 4 }), { a: 4 });
  assert.throws(() => extractJson("no json here"), /No JSON/);
  assert.throws(() => extractJson('{"a":'), /Unterminated|JSON/);
});

test("chatContent reads string and part-array content", () => {
  assert.equal(chatContent({ choices: [{ message: { content: "x" } }] }), "x");
  assert.equal(chatContent({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] }), "ab");
  assert.equal(chatContent({}), "");
});

test("normalizeListing fixes types, price order, hashtags and 'looks like'", () => {
  const n = normalizeListing({ title: "T", category: "alien", product_type: "Socks", colours: "Blue, White", hashtags: ["fashion", "#pk style", "##x"],
    material_guess: "made of cotton", price_suggestion_pkr: { min: 3000, max: 2000 }, size_chart: { rows: [["S", 38]] } });
  assert.equal(n.category, "men"); assert.equal(n.product_type, "Other"); assert.deepEqual(n.colours, ["Blue", "White"]);
  assert.deepEqual(n.hashtags, ["#fashion", "#pkstyle", "#x"]); assert.equal(n.material_guess, "looks like cotton");
  assert.deepEqual([n.price_suggestion_pkr.min, n.price_suggestion_pkr.max], [2000, 3000]);
  assert.match(n.price_suggestion_pkr.note, /Suggestion/); assert.deepEqual(n.size_chart.rows, [["S", "38"]]);
  const empty = normalizeListing(null); assert.equal(empty.title, ""); assert.deepEqual(empty.hashtags, []);
});

test("demo sample passes normalisation unchanged-ish and has no risky claims", () => {
  const n = normalizeListing(sample);
  assert.equal(n.title, sample.title); assert.equal(n.hashtags.length, 10);
  assert.deepEqual(findRiskyClaims(n), []);
});

test("findRiskyClaims flags authenticity, 100% and bare fabric facts", () => {
  const w = findRiskyClaims({ title: "Original Branded Polo", description_en: "Made from 100% cotton.", social_caption: "Looks like cotton, very soft" });
  const labels = w.map((x) => x.label);
  assert.ok(labels.includes("brand/authenticity claim")); assert.ok(labels.includes("100% claim")); assert.ok(labels.includes("fabric stated as fact"));
  assert.ok(!w.some((x) => x.field === "social_caption"));
});

test("listing request: muse-spark, image part, json_schema, never reasoning 'none'", () => {
  const r = buildListingRequest({ imageDataUrl: "data:image/jpeg;base64,AAA", hint: "x".repeat(500) });
  assert.equal(r.model, "muse-spark-1.3"); assert.notEqual(r.reasoning_effort, "none");
  assert.equal(r.response_format.type, "json_schema"); assert.equal(r.response_format.json_schema.schema, LISTING_SCHEMA);
  assert.equal(r.messages[1].content[1].image_url.url, "data:image/jpeg;base64,AAA");
  assert.ok(r.messages[1].content[0].text.length < 400);
});

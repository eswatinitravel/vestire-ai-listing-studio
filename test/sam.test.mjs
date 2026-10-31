import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { encodeSegmentationMask } from "../node_modules/@meta-sam/parser/dist/mask-codec.js";
import { parseSamText, pickBestMask, buildAlpha, alphaBBox, samPrompt, frameSizeOf } from "../src/lib/sam.js";

function wire(objs, W, H) {
  return "<0f>" + objs.map(({ id, x, y, w, h, raster, c }) => {
    const m = encodeSegmentationMask(raster, w, h);
    const conf = c ? `;c=${c}` : "";
    return `${id}<|box;x1=${x};y1=${y};x2=${x + w - 1};y2=${y + h - 1};w=${W};h=${H}${conf}|><|mask;x=0;y=0${conf};data=${h},${w},${m.payload}|>`;
  }).join(",") + "\n";
}
const full = (w, h, f) => { const r = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r[y * w + x] = f(x, y) ? 1 : 0; return r; };

test("decodes a SAM mask round-trip and positions it at the box", async () => {
  const raster = full(10, 6, (x, y) => x >= 2 && y >= 1);
  const text = wire([{ id: 0, x: 5, y: 4, w: 10, h: 6, raster }], 20, 12);
  const r = await parseSamText(text);
  assert.equal(r.empty, false); assert.equal(r.masks.length, 1); assert.deepEqual(r.frame, { width: 20, height: 12 });
  const m = r.masks[0];
  assert.deepEqual([...m.raster], [...raster]);
  assert.deepEqual(m.bounds, { left: 5, top: 4, right: 15, bottom: 10 });
  const a = buildAlpha(m, r.frame, 20, 12);
  assert.equal(a[4 * 20 + 5], 0);      // raster (0,0) off
  assert.equal(a[5 * 20 + 7], 255);    // raster (2,1) on
  assert.equal(a[0], 0);
  assert.deepEqual(alphaBBox(a, 20, 12), { x: 7, y: 5, w: 8, h: 5 });
});

test("scales the alpha map to a different output size", async () => {
  const raster = full(4, 4, () => true);
  const r = await parseSamText(wire([{ id: 0, x: 4, y: 4, w: 4, h: 4, raster }], 8, 8));
  const a = buildAlpha(r.masks[0], r.frame, 16, 16);
  let on = 0; for (const v of a) if (v) on++;
  assert.equal(on, 64); assert.equal(a[8 * 16 + 8], 255); assert.equal(a[7 * 16 + 7], 0);
});

test("handles a mask raster smaller than its box", async () => {
  const raster = full(2, 2, (x, y) => x === 0 && y === 0);
  const r = await parseSamText(wire([{ id: 0, x: 0, y: 0, w: 2, h: 2, raster }], 4, 4));
  const m = { ...r.masks[0], bounds: { left: 0, top: 0, right: 4, bottom: 4 } }; // pretend box is 4x4
  const a = buildAlpha(m, { width: 4, height: 4 }, 4, 4);
  assert.deepEqual([...a].map((v) => (v ? 1 : 0)), [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("picks the biggest confident object; sparse ids and confidence parse", async () => {
  const small = full(3, 3, () => true), big = full(8, 8, () => true);
  const text = wire([{ id: 0, x: 0, y: 0, w: 3, h: 3, raster: small, c: "0.99" }, { id: 2, x: 10, y: 10, w: 8, h: 8, raster: big, c: "0.9" }], 32, 32);
  const r = await parseSamText(text);
  assert.equal(r.masks.length, 2);
  assert.deepEqual(r.masks.map((m) => m.objectId), ["0", "2"]);
  assert.equal(pickBestMask(r.masks).objectId, "2");
  assert.equal(r.masks[1].confidence, 0.9);
});

test("zero matches is a normal empty result", async () => {
  const r = await parseSamText("");
  assert.equal(r.empty, true); assert.equal(pickBestMask(r.masks), null); assert.equal(frameSizeOf(""), null);
});

test("shipped demo sample decodes to a garment-sized mask", async () => {
  const r = await parseSamText(fs.readFileSync(new URL("../public/demo/sam-sample.txt", import.meta.url), "utf8"));
  assert.equal(r.masks.length, 1); assert.deepEqual(r.frame, { width: 800, height: 800 });
  const share = r.masks[0].area / (800 * 800);
  assert.ok(share > 0.1 && share < 0.5, `garment covers ${share}`);
});

test("samPrompt makes a short noun phrase", () => {
  assert.equal(samPrompt("  Polo Shirt!! please segment"), "polo shirt please");
  assert.equal(samPrompt(""), "shirt"); assert.equal(samPrompt("jacket"), "jacket");
});

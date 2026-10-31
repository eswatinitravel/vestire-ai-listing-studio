import test from "node:test"; import assert from "node:assert/strict";
import { colourToRGB, rgbToHsl, hslToRgb, recolourPixels } from "../src/lib/compose.js";
test("colour names resolve (multi-word, hex, fallback word)", () => {
  assert.deepEqual(colourToRGB("Navy Blue"), [20, 33, 61]); assert.deepEqual(colourToRGB("#ff0000"), [255, 0, 0]);
  assert.deepEqual(colourToRGB("deep maroon"), [110, 22, 34]); assert.equal(colourToRGB("unicorn"), null);
});
test("hsl round-trip", () => { for (const c of [[20, 33, 61], [240, 240, 236], [190, 30, 45]]) { const back = hslToRgb(...rgbToHsl(...c)); back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) <= 1)); } });
test("recolour keeps transparent pixels and shading order", () => {
  const d = new Uint8ClampedArray([200, 200, 200, 255, 100, 100, 100, 255, 9, 9, 9, 0]);
  assert.equal(recolourPixels(d, [20, 33, 61]), 2);
  assert.deepEqual([...d.slice(8)], [9, 9, 9, 0]);
  const l = (i) => rgbToHsl(d[i], d[i + 1], d[i + 2])[2]; assert.ok(l(0) > l(4));
  const [h] = rgbToHsl(d[0], d[1], d[2]); assert.ok(Math.abs(h - rgbToHsl(20, 33, 61)[0]) < 0.02);
});

// Free image steps done on canvas: colour maths for the variant preview (pure, unit-tested) + canvas composition helpers.
export const NAMED = {
  navy: [20, 33, 61], "navy blue": [20, 33, 61], black: [22, 22, 24], white: [240, 240, 236], grey: [128, 128, 128], gray: [128, 128, 128],
  charcoal: [54, 57, 64], maroon: [110, 22, 34], red: [190, 30, 45], burgundy: [110, 20, 40], olive: [96, 104, 52], "olive green": [96, 104, 52],
  green: [34, 120, 60], "bottle green": [20, 72, 45], mustard: [214, 162, 40], yellow: [235, 200, 50], beige: [214, 196, 160], khaki: [189, 170, 120],
  cream: [238, 228, 205], brown: [110, 70, 40], "sky blue": [135, 190, 230], blue: [40, 90, 180], teal: [20, 128, 128], pink: [235, 150, 170],
  purple: [100, 50, 140], orange: [230, 120, 40], "light blue": [160, 200, 230], "dark green": [25, 70, 40], tan: [200, 160, 110],
};
export function colourToRGB(name) {
  const n = String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (NAMED[n]) return NAMED[n];
  const hex = n.match(/^#?([0-9a-f]{6})$/); if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  for (const w of n.split(" ").reverse()) if (NAMED[w]) return NAMED[w];
  return null;
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
export function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
/** Recolours RGBA pixels in place where alpha>0: keeps shading (lightness relative to the garment's mean), takes target hue/sat. */
export function recolourPixels(data, target) {
  const [th, ts, tl] = rgbToHsl(...target);
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) { sum += rgbToHsl(data[i], data[i + 1], data[i + 2])[2]; n++; }
  const mean = n ? sum / n : 0.5;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const l = rgbToHsl(data[i], data[i + 1], data[i + 2])[2];
    const nl = Math.min(0.97, Math.max(0.03, tl + (l - mean) * 0.9));
    const [r, g, b] = hslToRgb(th, ts, nl); data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  return n;
}
export const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
/** Garment cut-out (canvas/img) centred on a square background with a soft shadow. bg: CSS colour or image. */
export function composeOn(cut, { size = 1024, bg = "#fff", scale = 0.78, shadow = "studio" } = {}) {
  const c = canvas(size, size), g = c.getContext("2d");
  if (typeof bg === "string") { g.fillStyle = bg; g.fillRect(0, 0, size, size); }
  else { const k = Math.max(size / bg.width, size / bg.height); g.drawImage(bg, (size - bg.width * k) / 2, (size - bg.height * k) / 2, bg.width * k, bg.height * k); }
  const k = Math.min((size * scale) / cut.width, (size * scale) / cut.height);
  const w = cut.width * k, h = cut.height * k, x = (size - w) / 2, y = (size - h) / 2;
  if (shadow === "studio") { const rg = g.createRadialGradient(size / 2, y + h + 4, 4, size / 2, y + h + 4, w / 2);
    rg.addColorStop(0, "rgba(0,0,0,.22)"); rg.addColorStop(1, "rgba(0,0,0,0)"); g.save(); g.translate(0, 0); g.scale(1, 0.12); g.fillStyle = rg;
    g.fillRect(0, (y + h - w / 2) / 0.12, size, w / 0.12); g.restore(); }
  g.save(); g.shadowColor = shadow === "flatlay" ? "rgba(0,0,0,.35)" : "rgba(0,0,0,.12)"; g.shadowBlur = shadow === "flatlay" ? 28 : 14;
  g.shadowOffsetX = shadow === "flatlay" ? 10 : 0; g.shadowOffsetY = shadow === "flatlay" ? 16 : 6; g.drawImage(cut, x, y, w, h); g.restore();
  return c;
}

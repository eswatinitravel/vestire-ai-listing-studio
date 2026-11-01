// Fetch Lucide icons (ISC licence, https://lucide.dev) once and write the inline SVG sprite used by index.html.
// Run: node tools/icons.mjs  → public/icons.svg.txt (inlined into index.html at build time by tools/build.mjs)
import fs from "node:fs";
const NAMES = ["camera", "image", "sparkles", "scissors", "layers", "file-text", "aperture", "layout-panel-top", "palette", "download",
  "file-spreadsheet", "message-circle", "copy", "shopping-bag", "settings", "check", "x", "loader-circle", "upload", "shirt", "cpu", "cloud",
  "monitor-smartphone", "arrow-right", "triangle-alert", "info", "circle-check", "refresh-cw", "mouse-pointer-click", "lock", "zap", "rotate-ccw"];
const out = [];
for (const n of NAMES) {
  const r = await fetch(`https://cdn.jsdelivr.net/npm/lucide-static@0.469.0/icons/${n}.svg`);
  if (!r.ok) throw new Error(n + " " + r.status);
  const svg = await r.text();
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\s*\n\s*/g, "");
  out.push(`<symbol id="i-${n}" viewBox="0 0 24 24">${inner}</symbol>`);
}
fs.writeFileSync(new URL("../public/icons.svg.txt", import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true"><!-- Lucide icons, ISC licence, lucide.dev -->${out.join("")}</svg>\n`);
console.log("icons", NAMES.length);

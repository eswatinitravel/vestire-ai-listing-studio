// Build: bundle the browser app, inline static files into the worker, emit pages-dist/_worker.js (+ _routes.json).
import fs from "node:fs"; import path from "node:path"; import * as esbuild from "esbuild";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });
await esbuild.build({ entryPoints: [path.join(root, "src/app.js")], bundle: true, format: "esm", target: "es2020", minify: true, outfile: path.join(out, "app.js"), logLevel: "warning" });
// SlimSAM runs in its own module Web Worker so the page never freezes.
await esbuild.build({ entryPoints: [path.join(root, "src/sam.worker.js")], bundle: true, format: "esm", target: "es2020", minify: true, outfile: path.join(out, "sam-worker.js"), logLevel: "warning" });
// Inline the Lucide icon sprite into index.html.
const sprite = path.join(out, "icons.svg.txt");
if (fs.existsSync(sprite)) { const h = path.join(out, "index.html"); fs.writeFileSync(h, fs.readFileSync(h, "utf8").replace("<!--ICONS-->", fs.readFileSync(sprite, "utf8").trim())); fs.rmSync(sprite); }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const assets = {};
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else {
  const ext = path.extname(f), rel = "/" + path.relative(out, p).split(path.sep).join("/"), bin = /^(image\/(jpeg|png|webp)|font\/woff2)/.test(TYPES[ext] || "");
  assets[rel] = { type: TYPES[ext] || "application/octet-stream", b64: bin, body: bin ? fs.readFileSync(p).toString("base64") : fs.readFileSync(p, "utf8") }; } } };
walk(out);
fs.writeFileSync(path.join(root, "worker/_assets.gen.js"), "export const ASSETS = " + JSON.stringify(assets) + ";\n");
const pd = path.join(root, "pages-dist"); fs.rmSync(pd, { recursive: true, force: true }); fs.mkdirSync(pd);
await esbuild.build({ entryPoints: [path.join(root, "worker/index.js")], bundle: true, format: "esm", platform: "neutral", target: "es2022", minify: true,
  outfile: path.join(pd, "_worker.js"), conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], logLevel: "warning" });
fs.writeFileSync(path.join(pd, "_routes.json"), JSON.stringify({ version: 1, include: ["/*"], exclude: [] }));
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + " KB";
console.log("assets:", Object.keys(assets).join(", "));
console.log("dist/app.js", kb(path.join(out, "app.js")), "| pages-dist/_worker.js", kb(path.join(pd, "_worker.js")));

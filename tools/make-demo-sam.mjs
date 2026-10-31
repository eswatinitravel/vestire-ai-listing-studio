// Builds public/demo/sam-sample.txt: a SAM 3.1 wire line for the demo photo (800x800), with a
// real mask encoded by Meta's own codec, so demo mode exercises the exact parser + cut-out path.
import fs from "node:fs";
import { encodeSegmentationMask } from "../node_modules/@meta-sam/parser/dist/mask-codec.js";
const meta = JSON.parse(fs.readFileSync("/tmp/mask.json", "utf8"));
const raster = new Uint8Array(fs.readFileSync("/tmp/mask.bin"));
const m = encodeSegmentationMask(raster, meta.w, meta.h);
const marker = m.encoding === "one_bit" ? "!" : "~";
const box = `<|box;x1=${meta.left};y1=${meta.top};x2=${meta.left + meta.w - 1};y2=${meta.top + meta.h - 1};w=800;h=800;c=0.97265625|>`;
const mask = `<|mask;x=0;y=0;c=0.97265625;data=${meta.h},${meta.w},${m.payload.startsWith(marker) ? m.payload : marker + m.payload}|>`;
fs.writeFileSync("public/demo/sam-sample.txt", `<0f>0${box}${mask}\n`);
console.log("written", m.encoding, m.payload.length, "chars");

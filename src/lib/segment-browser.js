// In-browser cut-out with SlimSAM (a compressed Meta Segment Anything model, Apache-2.0) via transformers.js (Apache-2.0).
// Runs on the shopper's phone/laptop in a Web Worker (src/sam.worker.js), so the page never freezes. No server, no key, no cost.
import { createSamClient } from "./sam-core.js";
export const SLIMSAM = "Xenova/slimsam-77-uniform";
let client = null;
function sam() {
  if (!client) client = createSamClient(new Worker("/sam-worker.js", { type: "module", name: "slimsam" }));
  return client;
}
/** Start downloading + compiling the model in the worker (call on page load). */
export function warmSam() { sam().warm(); }
export function onSamStatus(f) { return sam().onStatus(f); }
/** Precompute the image embedding (the slow part) as soon as a photo is chosen. */
export function embedPhoto(key, dataUrl) { return sam().embed(key, dataUrl); }
/** point: {x,y} in image pixels (positive click). Returns {alpha:Uint8ClampedArray(0/255), width, height, score, embedMs, decodeMs}. */
export function segmentPoint(key, dataUrl, point) { return sam().segment(key, dataUrl, point); }

// Web Worker: SlimSAM (compressed Meta Segment Anything, Apache-2.0) via transformers.js (Apache-2.0), off the main thread.
// Model files come from the Hugging Face CDN once and are kept in the browser's Cache API ("transformers-cache").
import { createSamHandler } from "./lib/sam-core.js";
const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const SLIMSAM = "Xenova/slimsam-77-uniform";

async function load(onProgress) {
  const T = await import(/* @vite-ignore */ TJS);
  T.env.allowLocalModels = false;
  T.env.useBrowserCache = true;
  // Multi-threaded WASM when the page is cross-origin isolated (COOP + COEP credentialless); single thread otherwise.
  if (self.crossOriginIsolated) T.env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
  let cached = false;
  try {
    const c = await caches.open("transformers-cache");
    cached = !!(await c.match(`https://huggingface.co/${SLIMSAM}/resolve/main/onnx/vision_encoder_quantized.onnx`));
  } catch { /* no Cache API */ }
  const opts = { dtype: "q8", progress_callback: onProgress };
  const [model, processor] = await Promise.all([T.SamModel.from_pretrained(SLIMSAM, opts), T.AutoProcessor.from_pretrained(SLIMSAM)]);
  return { model, processor, RawImage: T.RawImage, cached, threads: T.env.backends.onnx.wasm.numThreads || 1 };
}

const handle = createSamHandler({ load });
self.onmessage = (e) => handle(e.data, (m, transfer) => self.postMessage(m, transfer || []));

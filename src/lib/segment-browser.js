// In-browser cut-out with SlimSAM (a compressed Meta Segment Anything model, Apache-2.0) via transformers.js (Apache-2.0).
// Runs on the shopper's phone/laptop: no server, no key, no cost. Model files come from the Hugging Face CDN (~14 MB, cached).
const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
export const SLIMSAM = "Xenova/slimsam-77-uniform";
let loading = null;
export function loadSam(onStatus = () => {}) {
  if (!loading) loading = (async () => {
    onStatus("downloading model…");
    const { SamModel, AutoProcessor, env } = await import(/* @vite-ignore */ TJS);
    env.allowLocalModels = false;
    const model = await SamModel.from_pretrained(SLIMSAM, { dtype: "q8" });
    const processor = await AutoProcessor.from_pretrained(SLIMSAM);
    const { RawImage } = await import(/* @vite-ignore */ TJS);
    return { model, processor, RawImage };
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
/** point: {x,y} in image pixels (positive click). Returns {alpha:Uint8ClampedArray(0/255), width, height, score}. */
export async function segmentPoint(dataUrl, point, onStatus) {
  const { model, processor, RawImage } = await loadSam(onStatus);
  onStatus?.("segmenting…");
  const image = await RawImage.fromURL(dataUrl);
  const inputs = await processor(image, { input_points: [[[point.x, point.y]]], input_labels: [[1]] });
  const emb = await model.get_image_embeddings(inputs);
  const out = await model({ ...inputs, ...emb });
  const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const m = masks[0], [, n, H, W] = m.dims, s = out.iou_scores.data;
  let best = 0; for (let i = 1; i < n; i++) if (s[i] > s[best]) best = i;
  const alpha = new Uint8ClampedArray(W * H), off = best * W * H;
  for (let i = 0; i < W * H; i++) alpha[i] = m.data[off + i] ? 255 : 0;
  return { alpha, width: W, height: H, score: s[best] };
}

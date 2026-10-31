// SAM 3.1 output helpers: turn the `output_text` wire grammar into masks and an alpha map.
// Uses Meta's @meta-sam/parser for the grammar + base85 mask codec.
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from "@meta-sam/parser";

const LANE = { item_id: "msg_0", output_index: 0, content_index: 0 };

/** Replays a complete SAM output_text (non-streamed response or saved sample) as Responses stream events. */
export async function* textToEvents(text) {
  const lines = String(text || "").split("\n").filter((l) => l.trim());
  for (const line of lines) yield { type: "response.output_text.delta", delta: line + "\n", ...LANE };
  yield { type: "response.output_text.done", text: String(text || ""), ...LANE };
  yield { type: "response.completed" };
}

/** Pulls the source frame size (w/h) the boxes refer to. */
export function frameSizeOf(text) {
  const m = /<\|box;[^|]*?w=(\d+);h=(\d+)/.exec(String(text || ""));
  return m ? { width: +m[1], height: +m[2] } : null;
}

/**
 * Parses SAM output text into decoded masks.
 * @returns {Promise<{frame:{width,height}|null, masks:Array, diagnostics:Array, empty:boolean}>}
 */
export async function parseSamText(text) {
  const result = await parseImageStream(textToEvents(text)).finalResult;
  const masks = recordsOfKind(result.records, "mask").map((r) => {
    const raster = decodeMaskToRaster(r.mask);
    let on = 0; for (let i = 0; i < raster.length; i++) on += raster[i];
    const bw = r.bounds.right - r.bounds.left, bh = r.bounds.bottom - r.bounds.top;
    const coverage = raster.length ? on / raster.length : 0;
    return {
      objectId: r.objectId, bounds: r.bounds, raster, mw: r.mask.width, mh: r.mask.height,
      confidence: r.confidence, area: Math.round(coverage * bw * bh),
    };
  });
  return { frame: frameSizeOf(text), masks, diagnostics: result.diagnostics, empty: masks.length === 0 };
}

/** Picks the garment: biggest area, weighted by confidence when present. */
export function pickBestMask(masks) {
  let best = null, score = -1;
  for (const m of masks || []) {
    const s = m.area * (typeof m.confidence === "number" ? m.confidence : 1);
    if (s > score) { score = s; best = m; }
  }
  return best;
}

/**
 * Builds a full-size alpha map (0/255) for an output image of outW x outH from a mask whose
 * bounds are in frame pixels. The mask raster (mw x mh) covers the bounds box and may be smaller.
 */
export function buildAlpha(mask, frame, outW, outH) {
  const alpha = new Uint8ClampedArray(outW * outH);
  if (!mask) return alpha;
  const fw = frame?.width || outW, fh = frame?.height || outH;
  const { left, top, right, bottom } = mask.bounds;
  const bw = right - left, bh = bottom - top;
  const sx = fw / outW, sy = fh / outH;
  const x0 = Math.max(0, Math.floor(left / sx)), x1 = Math.min(outW, Math.ceil(right / sx));
  const y0 = Math.max(0, Math.floor(top / sy)), y1 = Math.min(outH, Math.ceil(bottom / sy));
  for (let y = y0; y < y1; y++) {
    const fy = (y + 0.5) * sy; if (fy < top || fy >= bottom) continue;
    const ry = Math.min(mask.mh - 1, Math.floor(((fy - top) * mask.mh) / bh));
    for (let x = x0; x < x1; x++) {
      const fx = (x + 0.5) * sx; if (fx < left || fx >= right) continue;
      const rx = Math.min(mask.mw - 1, Math.floor(((fx - left) * mask.mw) / bw));
      if (mask.raster[ry * mask.mw + rx]) alpha[y * outW + x] = 255;
    }
  }
  return alpha;
}

/** Tight bounding box of an alpha map, padded, clamped. */
export function alphaBBox(alpha, w, h, pad = 0) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(w, x1 + 1 + pad) - Math.max(0, x0 - pad), h: Math.min(h, y1 + 1 + pad) - Math.max(0, y0 - pad) };
}

/** Normalises the user's garment word into a short SAM noun phrase. */
export function samPrompt(word) {
  const t = String(word || "").toLowerCase().replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
  return t || "shirt";
}

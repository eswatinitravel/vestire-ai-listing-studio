// SlimSAM in a Web Worker: the pure parts (message handler, client RPC, mask → alpha) live here so they can be unit-tested
// in Node with a fake model. The real worker entry (src/sam.worker.js) only supplies the transformers.js loader.

/** Scale (w,h) so the longest side is at most `max` (never upscales). */
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}

/** Pick the mask with the best IoU score from SAM's [1, n, H, W] boolean masks → Uint8ClampedArray alpha (0/255). */
export function bestMaskAlpha(data, n, H, W, scores) {
  let best = 0; for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;
  const alpha = new Uint8ClampedArray(W * H), off = best * W * H;
  for (let i = 0; i < W * H; i++) alpha[i] = data[off + i] ? 255 : 0;
  return { alpha, best, score: Number(scores[best]) };
}

/** Sums per-file download progress (transformers.js progress_callback events) into one 0–100 figure. */
export function progressTracker() {
  const files = new Map();
  return (ev) => {
    if (!ev || !ev.file) return null;
    const f = files.get(ev.file) || { loaded: 0, total: 0 };
    if (ev.status === "progress") { f.loaded = ev.loaded || 0; f.total = ev.total || f.total; }
    if (ev.status === "done") f.loaded = f.total = Math.max(f.total, f.loaded, 1);
    files.set(ev.file, f);
    let l = 0, t = 0; for (const x of files.values()) { l += x.loaded; t += x.total; }
    return t ? Math.min(100, Math.round((l / t) * 100)) : 0;
  };
}

/**
 * Worker-side message handler. `load(onProgress)` resolves {model, processor, RawImage, cached}.
 * Messages in:  {type:"warm"} · {id,type:"embed",key,image} · {id,type:"segment",key,image,point:{x,y}}
 * Messages out: {type:"status",state:"loading"|"ready"|"error",progress?,cached?,ms?,error?} · {id,ok,...}
 */
export function createSamHandler({ load, now = () => (globalThis.performance ? performance.now() : Date.now()) }) {
  let modelP = null, emb = null; // emb = {key, promise}
  const ensure = (post) => {
    if (!modelP) {
      const t0 = now(), track = progressTracker(); let last = -1;
      post({ type: "status", state: "loading", progress: 0 });
      modelP = load((ev) => { const p = track(ev); if (p !== null && p !== last) { last = p; post({ type: "status", state: "loading", progress: p }); } })
        .then((m) => { post({ type: "status", state: "ready", cached: !!m.cached, ms: Math.round(now() - t0) }); return m; })
        .catch((e) => { modelP = null; post({ type: "status", state: "error", error: String(e?.message || e).slice(0, 160) }); throw e; });
    }
    return modelP;
  };
  const embed = (post, key, image) => {
    if (emb && emb.key === key) return emb.promise;
    const p = (async () => {
      const { model, processor, RawImage } = await ensure(post);
      const t0 = now();
      const img = await RawImage.fromURL(image);
      const inputs = await processor(img);
      const e = await model.get_image_embeddings(inputs);
      return { inputs, e, ms: Math.round(now() - t0) };
    })();
    emb = { key, promise: p };
    p.catch(() => { if (emb && emb.promise === p) emb = null; });
    return p;
  };
  return async function handle(msg, post) {
    const { id, type } = msg || {};
    try {
      if (type === "warm") { await ensure(post).catch(() => {}); return; }
      if (type === "embed") { const r = await embed(post, msg.key, msg.image); post({ id, ok: true, ms: r.ms }); return; }
      if (type === "segment") {
        const tw = now();
        const { inputs, e } = await embed(post, msg.key, msg.image);
        const embedWaitMs = Math.round(now() - tw); // 0 when the embedding was precomputed on upload
        const { model, processor } = await ensure(post);
        const t0 = now();
        const ip = processor.image_processor || processor;
        const input_points = ip.reshape_input_points([[[msg.point.x, msg.point.y]]], inputs.original_sizes, inputs.reshaped_input_sizes);
        const input_labels = ip.add_input_labels([[1]], input_points);
        const out = await model({ ...inputs, input_points, input_labels, ...e });
        const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
        const m = masks[0], [, n, H, W] = m.dims;
        const r = bestMaskAlpha(m.data, n, H, W, out.iou_scores.data);
        post({ id, ok: true, alpha: r.alpha, width: W, height: H, score: r.score, embedMs: embedWaitMs, decodeMs: Math.round(now() - t0) }, [r.alpha.buffer]);
        return;
      }
      post({ id, ok: false, error: "unknown message " + type });
    } catch (err) { post({ id, ok: false, error: String(err?.message || err).slice(0, 200) }); }
  };
}

/** Main-thread side: promise RPC over a Worker-like object ({postMessage, onmessage}). */
export function createSamClient(worker) {
  let seq = 0; const pending = new Map(), listeners = new Set(); let status = { state: "idle" };
  worker.onmessage = (ev) => {
    const d = ev.data || {};
    if (d.type === "status") { status = d; listeners.forEach((f) => f(d)); return; }
    const p = pending.get(d.id); if (!p) return; pending.delete(d.id);
    d.ok ? p.resolve(d) : p.reject(new Error(d.error || "worker error"));
  };
  worker.onerror = (e) => { const err = new Error(e?.message || "SAM worker failed to start"); status = { type: "status", state: "error", error: err.message }; listeners.forEach((f) => f(status)); for (const p of pending.values()) p.reject(err); pending.clear(); };
  const request = (type, payload = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }); });
  return {
    warm: () => worker.postMessage({ type: "warm" }),
    embed: (key, image) => request("embed", { key, image }),
    segment: (key, image, point) => request("segment", { key, image, point }),
    onStatus: (f) => { listeners.add(f); f(status); return () => listeners.delete(f); },
    get status() { return status; },
  };
}

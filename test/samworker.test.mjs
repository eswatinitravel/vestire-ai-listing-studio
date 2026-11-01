import test from "node:test"; import assert from "node:assert/strict";
import { fitSize, bestMaskAlpha, progressTracker, createSamHandler, createSamClient } from "../src/lib/sam-core.js";

test("fitSize: caps the longest side, never upscales", () => {
  assert.deepEqual(fitSize(2000, 1000, 672), { w: 672, h: 336, k: 0.336 });
  assert.deepEqual(fitSize(400, 300, 672), { w: 400, h: 300, k: 1 });
  assert.equal(fitSize(1000, 3000, 1024).h, 1024);
});

test("bestMaskAlpha: picks the highest IoU mask and maps to 0/255", () => {
  // 3 masks of 2x2
  const data = [1, 0, 0, 0, /* best */ 1, 1, 0, 1, 0, 0, 0, 0];
  const r = bestMaskAlpha(data, 3, 2, 2, [0.5, 0.9, 0.1]);
  assert.equal(r.best, 1); assert.equal(r.score, 0.9); assert.deepEqual([...r.alpha], [255, 255, 0, 255]);
});

test("progressTracker: sums bytes across files", () => {
  const t = progressTracker();
  assert.equal(t({ status: "progress", file: "a", loaded: 50, total: 100 }), 50);
  assert.equal(t({ status: "progress", file: "b", loaded: 0, total: 100 }), 25);
  assert.equal(t({ status: "done", file: "a" }), 50);
  assert.equal(t({ status: "initiate" }), null);
});

function fakeModel() {
  const calls = { embed: 0, decode: 0, load: 0 };
  const processor = async () => ({ pixel_values: "px", original_sizes: [[4, 4]], reshaped_input_sizes: [[8, 8]] });
  processor.image_processor = {
    reshape_input_points: (p, o, r) => ({ dims: [1, 1, 1, 2], pts: p[0][0].map((v) => v * r[0][0] / o[0][0]) }),
    add_input_labels: (l) => ({ labels: l }),
  };
  processor.post_process_masks = async () => [{ dims: [1, 2, 4, 4], data: new Uint8Array(32).map((_, i) => (i >= 16 && i % 2 ? 1 : 0)) }];
  const model = async (inp) => { calls.decode++; calls.lastPts = inp.input_points.pts; assert.equal(inp.image_embeddings, "EMB"); return { pred_masks: "m", iou_scores: { data: [0.2, 0.8] } }; };
  model.get_image_embeddings = async () => { calls.embed++; return { image_embeddings: "EMB" }; };
  const load = async (onProgress) => { calls.load++; onProgress({ status: "progress", file: "x", loaded: 5, total: 10 }); return { model, processor, RawImage: { fromURL: async () => "img" }, cached: true }; };
  return { load, calls };
}

test("worker handler: warm loads once and reports progress then ready", async () => {
  const { load, calls } = fakeModel(); const out = [];
  const h = createSamHandler({ load, now: () => 0 });
  await h({ type: "warm" }, (m) => out.push(m)); await h({ type: "warm" }, (m) => out.push(m));
  assert.equal(calls.load, 1);
  assert.deepEqual(out.map((m) => m.state), ["loading", "loading", "ready"]);
  assert.equal(out[1].progress, 50); assert.equal(out[2].cached, true);
});

test("worker handler: embedding is computed once per photo key and reused by segment", async () => {
  const { load, calls } = fakeModel(); const out = []; const post = (m, t) => out.push({ m, t });
  const h = createSamHandler({ load, now: () => 0 });
  await h({ id: 1, type: "embed", key: 7, image: "data:x" }, post);
  await h({ id: 2, type: "segment", key: 7, image: "data:x", point: { x: 2, y: 1 } }, post);
  assert.equal(calls.embed, 1); assert.equal(calls.decode, 1);
  assert.deepEqual(calls.lastPts, [4, 2]); // scaled from original 4px to reshaped 8px
  const seg = out.find((o) => o.m.id === 2);
  assert.equal(seg.m.ok, true); assert.equal(seg.m.score, 0.8); assert.equal(seg.m.width, 4); assert.equal(seg.m.embedMs, 0, "now() is frozen at 0, so no wait");
  assert.equal(seg.m.alpha.length, 16); assert.equal(seg.m.alpha[1], 255); assert.equal(seg.m.alpha[0], 0);
  assert.equal(seg.t[0], seg.m.alpha.buffer, "alpha buffer is transferred, not copied");
  await h({ id: 3, type: "segment", key: 8, image: "data:y", point: { x: 0, y: 0 } }, post);
  assert.equal(calls.embed, 2, "a new photo key recomputes the embedding");
});

test("worker handler: errors come back as {ok:false} and a failed load can be retried", async () => {
  let n = 0; const out = [];
  const h = createSamHandler({ load: async () => { n++; throw new Error("offline"); }, now: () => 0 });
  await h({ id: 1, type: "embed", key: 1, image: "x" }, (m) => out.push(m));
  assert.equal(out.at(-1).ok, false); assert.match(out.at(-1).error, /offline/);
  assert.ok(out.some((m) => m.type === "status" && m.state === "error"));
  await h({ id: 2, type: "embed", key: 1, image: "x" }, (m) => out.push(m));
  assert.equal(n, 2);
  await h({ id: 3, type: "nope" }, (m) => out.push(m)); assert.equal(out.at(-1).ok, false);
});

test("client: request/response by id, status fan-out, worker error rejects pending", async () => {
  const sent = []; const w = { postMessage: (m) => sent.push(m) };
  const c = createSamClient(w); const seen = [];
  c.onStatus((s) => seen.push(s.state));
  const p = c.embed(5, "data:z");
  assert.deepEqual(sent[0], { id: 1, type: "embed", key: 5, image: "data:z" });
  w.onmessage({ data: { type: "status", state: "ready" } });
  w.onmessage({ data: { id: 1, ok: true, ms: 12 } });
  assert.equal((await p).ms, 12); assert.deepEqual(seen, ["idle", "ready"]); assert.equal(c.status.state, "ready");
  const q = c.segment(5, "data:z", { x: 1, y: 1 });
  w.onerror({ message: "boom" });
  await assert.rejects(q, /boom/); assert.equal(c.status.state, "error");
  c.warm(); assert.equal(sent.at(-1).type, "warm");
});

test("server sends COOP/COEP so the page is cross-origin isolated (threads) and serves the SAM worker", async () => {
  const { default: worker, SEC } = await import("../worker/index.js");
  assert.equal(SEC["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(SEC["Cross-Origin-Embedder-Policy"], "credentialless");
  const r = await worker.fetch(new Request("https://x.test/"), {});
  assert.equal(r.headers.get("Cross-Origin-Embedder-Policy"), "credentialless");
  const html = await r.text(); assert.ok(html.includes('id="i-scissors"'), "icon sprite inlined"); assert.ok(!html.includes("<!--ICONS-->"));
  const ws = await worker.fetch(new Request("https://x.test/sam-worker.js"), {});
  assert.equal(ws.status, 200); assert.match(ws.headers.get("Content-Type"), /javascript/);
  const f = await worker.fetch(new Request("https://x.test/fonts/geist-latin-wght.woff2"), {});
  assert.equal(f.headers.get("Content-Type"), "font/woff2"); assert.ok((await f.arrayBuffer()).byteLength > 10000);
});

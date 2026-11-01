// Vestire AI Listing Studio — browser app (bundled by tools/build.mjs).
import { parseSamText, pickBestMask, buildAlpha, alphaBBox, samPrompt } from "./lib/sam.js";
import { normalizeListing, findRiskyClaims, PRODUCT_TYPES } from "./lib/listing.js";
import { vestireCSV } from "./lib/csv.js";
import { buildListingPack, captionsText } from "./lib/pack.js";
import { colourToRGB, recolourPixels, composeOn, canvas as mkCanvas } from "./lib/compose.js";
import { segmentPoint, warmSam, onSamStatus, embedPhoto } from "./lib/segment-browser.js";
import { fitSize } from "./lib/sam-core.js";

const $ = (s) => document.querySelector(s);
const S = { live: false, provider: "demo", point: null, cutCanvas: null, models: {}, photo: null, photoIsSample: false, prompt: "shirt", listing: null, shots: [], cutoutWhite: null, busy: false, stage: 1, photoKey: 0, samReady: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------- small UI helpers ----------
const ico = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
function setStage(n) {
  document.querySelectorAll("#stepper li").forEach((li) => { const k = +li.dataset.s; li.classList.toggle("is-done", k < n); li.classList.toggle("is-current", k === n); li.toggleAttribute("aria-current", k === n); });
  S.stage = n; syncMobileBar();
}
function syncMobileBar() {
  const btn = $("#mobileAction"); if (!btn) return;
  const ready = S.stage === 3 && S.listing;
  btn.innerHTML = ready ? `${ico("download")}<span>Download listing pack</span>` : S.busy ? `${ico("loader-circle")}<span>Generating…</span>` : `${ico("sparkles")}<span>Generate listing</span>`;
  btn.disabled = !!S.busy; btn.setAttribute("aria-busy", S.busy ? "true" : "false");
}
function setBusy(b) {
  S.busy = b; $("#goBtn").disabled = b; $("#variantBtn").disabled = b; $("#goBtn").setAttribute("aria-busy", b ? "true" : "false");
  $("#goBtn").innerHTML = b ? `${ico("loader-circle")}<span>Generating…</span>` : `${ico("sparkles")}<span>${S.listing ? "Generate again" : "Generate listing"}</span>`;
  syncMobileBar();
}

// ---------- pipeline view ----------
const STEP_SETS = {
  "workers-ai": [
    { id: "sam", ico: "scissors", name: "SlimSAM, Meta Segment Anything", sub: () => "Open weights, runs in your browser in a Web Worker" },
    { id: "cut", ico: "layers", name: "Cut-out on canvas", sub: () => "Transparent PNG and a white square" },
    { id: "spark", ico: "file-text", name: "Meta Llama 4 Scout 17B", sub: () => "Open weights on Cloudflare Workers AI, writes the listing" },
    { id: "studio", ico: "aperture", name: "Studio shot", sub: () => "Your real garment on white with a soft shadow" },
    { id: "life", ico: "layout-panel-top", name: "Flat-lay scene", sub: () => "FLUX.1 schnell paints an empty scene, your garment goes on it" },
  ],
  "meta-api": [
    { id: "sam", ico: "scissors", name: "SAM 3.1, segment the garment", sub: () => `Prompt “${S.prompt}” gives a box and a mask` },
    { id: "cut", ico: "layers", name: "Cut-out in the browser", sub: () => "@meta-sam/parser decodes the mask onto a canvas" },
    { id: "spark", ico: "file-text", name: "Muse Spark 1.3, listing JSON", sub: () => "Vision with structured output, English and Roman Urdu" },
    { id: "studio", ico: "aperture", name: "Muse Image 1.0, studio shot", sub: () => "White background, ghost mannequin" },
    { id: "life", ico: "layout-panel-top", name: "Muse Image 1.0, lifestyle shot", sub: () => "Model-style shot in a Lahore setting" },
  ],
};
STEP_SETS.demo = STEP_SETS["workers-ai"].map((x) => ({ ...x }));
const steps = () => STEP_SETS[S.provider] || STEP_SETS.demo;
function drawPipe() {
  $("#pipe").innerHTML = "";
  for (const s of steps()) {
    const li = document.createElement("li"); li.id = "p-" + s.id; li.className = "wait";
    li.innerHTML = `<span class="ix">${ico(s.ico)}</span><div><b></b><small></small></div><span class="st">Waiting</span>`;
    li.querySelector("b").textContent = s.name; li.querySelector("small").textContent = s.sub();
    $("#pipe").append(li);
  }
}
const timers = {};
const secs = (ms) => (ms / 1000).toFixed(1) + "s";
function stepState(id, state, extra = "") {
  const li = $("#p-" + id), el = li?.querySelector(".st"); if (!el) return;
  clearInterval(timers[id]?.iv);
  li.className = state === "running" ? "run" : state === "done" ? "done" : state === "error" ? "err" : "skip";
  if (state === "running") {
    const t0 = performance.now(); timers[id] = { t0, iv: setInterval(() => { el.textContent = secs(performance.now() - t0); }, 100) };
    el.textContent = "0.0s";
  } else if (state === "done") {
    const ms = timers[id] ? performance.now() - timers[id].t0 : 0;
    el.innerHTML = ico("check"); el.append((S.live ? "" : "demo ") + secs(ms) + (extra ? ", " + extra : ""));
  } else if (state === "error") { el.innerHTML = ico("x"); el.append("Failed"); li.title = extra; li.querySelector("small").textContent = extra; }
  else el.textContent = extra || "Skipped";
}

// ---------- image helpers ----------
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Image load failed")); i.src = src; }); }
async function fileToDataUrl(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try { return await downscale(url, max); } finally { URL.revokeObjectURL(url); }
}
async function downscale(src, max = 1024, type = "image/jpeg", q = 0.86) {
  const img = await loadImage(src);
  const f = fitSize(img.naturalWidth, img.naturalHeight, max);
  const c = document.createElement("canvas"); c.width = f.w; c.height = f.h;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, q);
}
/** Applies a full-size alpha map (0/255) to the photo → transparent PNG cut-out, white square JPEG, and the cut canvas. */
async function cutoutFromAlpha(photoUrl, alpha, W, H) {
  const img = await loadImage(photoUrl);
  const mc = mkCanvas(W, H); const md = mc.getContext("2d").createImageData(W, H);
  for (let i = 0; i < alpha.length; i++) md.data[i * 4 + 3] = alpha[i];
  mc.getContext("2d").putImageData(md, 0, 0);
  const c = mkCanvas(W, H), g = c.getContext("2d");
  g.drawImage(img, 0, 0, W, H); g.globalCompositeOperation = "destination-in"; g.filter = "blur(0.7px)"; g.drawImage(mc, 0, 0); g.filter = "none";
  const bb = alphaBBox(alpha, W, H, Math.round(Math.max(W, H) * 0.02)) || { x: 0, y: 0, w: W, h: H };
  const crop = mkCanvas(bb.w, bb.h); crop.getContext("2d").drawImage(c, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
  const side = Math.round(Math.max(bb.w, bb.h) * 1.12);
  const sq = mkCanvas(side, side), sg = sq.getContext("2d");
  sg.fillStyle = "#fff"; sg.fillRect(0, 0, side, side); sg.drawImage(crop, (side - bb.w) / 2, (side - bb.h) / 2);
  let on = 0; for (let i = 0; i < alpha.length; i++) if (alpha[i]) on++;
  return { png: crop.toDataURL("image/png"), white: sq.toDataURL("image/jpeg", 0.9), cut: crop, coverage: on / alpha.length };
}
/** SAM 3.1 wire text (Meta API or saved sample) → cut-out. */
async function makeCutout(photoUrl, samText) {
  const parsed = await parseSamText(samText);
  const best = pickBestMask(parsed.masks);
  if (!best) return { empty: true, parsed };
  const img = await loadImage(photoUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const out = await cutoutFromAlpha(photoUrl, buildAlpha(best, parsed.frame, W, H), W, H);
  return { empty: false, parsed, best, objects: parsed.masks.length, ...out };
}
const dataUrlBytes = (d) => { const b = atob(d.split(",")[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function urlToDataUrl(url) { const r = await fetch(url); const b = await r.blob(); return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }
function download(name, blobOrUrl) {
  const a = document.createElement("a"); a.download = name;
  a.href = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  document.body.append(a); a.click(); a.remove();
  if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- API ----------
async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let d = {}; try { d = await r.json(); } catch { /* */ }
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function museImage(kind, image, colour) {
  const d = await api("/api/image", { kind, image, colour });
  const b64 = d?.data?.[0]?.b64_json; if (!b64) throw new Error("No image returned");
  const fmt = d.output_format || "jpeg";
  return `data:image/${fmt === "jpg" ? "jpeg" : fmt};base64,${b64}`;
}

// ---------- gallery ----------
function setShot(key, label, src, name, opts = {}) {
  let s = S.shots.find((x) => x.key === key);
  if (!s) { s = { key }; S.shots.push(s); }
  Object.assign(s, { label, src, name, check: !!opts.check, loading: !!opts.loading, error: opts.error || "" });
  drawGallery();
}
function drawGallery() {
  const g = $("#gallery"); g.innerHTML = "";
  for (const s of S.shots) {
    const f = document.createElement("figure"); const cap = document.createElement("figcaption"); const sp = document.createElement("span");
    if (s.loading) {
      f.className = "shot loading"; f.setAttribute("aria-busy", "true");
      const sk = document.createElement("div"); sk.className = "sk"; sp.textContent = `${s.label}, working…`; cap.append(sp); f.append(sk, cap); g.append(f); continue;
    }
    if (s.error) {
      f.className = "shot error"; const e = document.createElement("div"); e.className = "err"; e.innerHTML = ico("triangle-alert");
      const m = document.createElement("span"); m.textContent = s.error; e.append(m); sp.textContent = s.label; cap.append(sp); f.append(e, cap); g.append(f); continue;
    }
    f.className = "shot" + (s.check ? " check" : "");
    const img = document.createElement("img"); img.src = s.src; img.alt = s.label; img.loading = "lazy";
    sp.textContent = s.label;
    const a = document.createElement("a"); a.href = s.src; a.download = s.name; a.innerHTML = ico("download"); a.setAttribute("aria-label", "Download " + s.label); a.title = "Download";
    cap.append(sp, a); f.append(img, cap); g.append(f);
  }
}

// ---------- review form ----------
function fillForm() {
  const L = S.listing;
  const sel = $("[data-f=product_type]"); if (!sel.options.length) for (const t of PRODUCT_TYPES) sel.add(new Option(t, t));
  document.querySelectorAll("[data-f]").forEach((el) => {
    const f = el.dataset.f, v = L[f];
    el.value = Array.isArray(v) ? v.join(el.dataset.list === "space" ? " " : ", ") : v ?? "";
  });
  const sc = L.size_chart; $("#sizeUnit").textContent = sc.unit ? `(${sc.unit})` : "";
  $("#sizeChart").value = [sc.columns, ...sc.rows].filter((r) => r && r.length).map((r) => r.join(", ")).join("\n");
  const p = L.price_suggestion_pkr;
  $("#priceSug").textContent = p.min && p.max ? `Rs ${p.min.toLocaleString("en-PK")} to ${p.max.toLocaleString("en-PK")}` : "No suggestion";
  $("#priceNote").textContent = p.note;
  if (!$("#priceInput").value && p.min && p.max) $("#priceInput").placeholder = String(Math.round((p.min + p.max) / 2 / 50) * 50 - 1);
  drawWarnings();
  requestAnimationFrame(() => document.querySelectorAll("#review textarea").forEach(grow));
}
function grow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 360) + "px"; }
function readForm() {
  const L = S.listing;
  document.querySelectorAll("[data-f]").forEach((el) => {
    const f = el.dataset.f;
    if (el.dataset.list === "space") L[f] = el.value.split(/\s+/).filter(Boolean).map((t) => "#" + t.replace(/^#+/, ""));
    else if (el.dataset.list) L[f] = el.value.split(",").map((x) => x.trim()).filter(Boolean);
    else L[f] = el.value;
  });
  const lines = $("#sizeChart").value.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((r) => r.some(Boolean));
  L.size_chart = { ...L.size_chart, columns: lines[0] || [], rows: lines.slice(1) };
}
function drawWarnings() {
  const w = findRiskyClaims(S.listing); const box = $("#warnings");
  if (!w.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden"); box.innerHTML = ico("triangle-alert");
  const p = document.createElement("p"); const b = document.createElement("b"); b.textContent = "Check before publishing: "; p.append(b);
  p.append(w.map((x) => `“${x.text}” in ${x.field.replace(/_/g, " ")} (${x.label})`).join("; ")); box.append(p);
}
const price = () => Math.round(Number(String($("#priceInput").value || $("#priceInput").placeholder).replace(/[^0-9.]/g, "")) || 0);
function waText() { const p = price(); return S.listing.whatsapp_text.replace(/Rs\s*_{2,}/i, p ? `Rs ${p.toLocaleString("en-PK")}` : "Rs ____"); }
function copyText(t) { navigator.clipboard?.writeText(t).then(() => toast("Copied"), () => toast("Copy failed — select and copy manually")); }

// ---------- the run ----------
const jpg = (c, q = 0.88) => c.toDataURL("image/jpeg", q);
async function segmentStep() {
  stepState("sam", "running");
  if (S.provider === "meta-api" || S.provider === "demo") {
    const text = S.provider === "meta-api" ? (await api("/api/segment", { image: S.photo, prompt: S.prompt })).text
      : (await sleep(900), await (await fetch("/demo/sam-sample.txt")).text());
    stepState("cut", "running");
    const cut = await makeCutout(S.photo, text);
    if (cut.empty) { stepState("sam", "done", "0 matches"); stepState("cut", "skip", "No garment found, try another word"); return null; }
    stepState("sam", "done", S.provider === "demo" ? "saved mask" : `${cut.objects} object${cut.objects > 1 ? "s" : ""}`);
    stepState("cut", "done"); return cut;
  }
  // workers-ai: SlimSAM in a Web Worker, point prompt (tap) or image centre. The embedding was usually precomputed on upload.
  const img = await loadImage(S.photo); const W = img.naturalWidth, H = img.naturalHeight;
  const pt = S.point || { x: Math.round(W / 2), y: Math.round(H / 2) };
  const sub = $("#p-sam small");
  if (!S.samReady) sub.textContent = "Waiting for the model to finish loading";
  const tSeg = performance.now();
  const r = await segmentPoint(S.photoKey, S.photo, pt);
  // The worker is busy (not listening) while it computes the embedding, so measure the wait here on the main thread.
  r.embedMs = performance.now() - tSeg - (r.decodeMs || 0);
  sub.textContent = r.embedMs > 600 ? `Open weights, in a Web Worker, waited ${secs(r.embedMs)} for the image embedding` : "Open weights, in a Web Worker, image embedding precomputed on upload";
  stepState("sam", "done", `IoU ${r.score.toFixed(2)}`);
  stepState("cut", "running");
  const cut = await cutoutFromAlpha(S.photo, r.alpha, r.width, r.height);
  if (cut.coverage < 0.02 || cut.coverage > 0.92) { stepState("cut", "done", "check it"); toast("Cut-out looks off? Tap the garment on the photo, then generate again.", 5000); }
  else stepState("cut", "done");
  return cut;
}
let lastListingHint = "";
async function listingStep() {
  stepState("spark", "running"); $("#listingError").classList.add("hidden"); $("#form").classList.add("is-loading");
  try {
    let listing, model = "";
    if (S.live) {
      // Llama 4 tiles images at 336px, so 672px (2x2 tiles) keeps detail while sending far fewer pixels than the full photo.
      const d = await api("/api/listing", { image: await downscale(S.photo, 672, "image/jpeg", 0.82), hint: lastListingHint });
      listing = d.listing; model = d.model || "";
    } else { await sleep(1700); listing = await (await fetch("/demo/listing-sample.json")).json(); }
    S.listing = normalizeListing(listing);
    stepState("spark", "done", /3\.2/.test(model) ? "fallback 3.2 Vision" : "");
    fillForm(); $("#form").classList.remove("is-loading"); $("#review").classList.remove("hidden");
  } catch (e) {
    stepState("spark", "error", e.message.slice(0, 80));
    $("#listingErrorMsg").textContent = e.message.slice(0, 140) + ". Your images are safe; try the text again.";
    $("#listingError").classList.remove("hidden");
  }
}
async function retryListing() {
  if (S.busy || !S.photo) return;
  setBusy(true);
  try { await listingStep(); if (S.listing) { setStage(3); setStatus(true, "Listing text ready"); } } finally { setBusy(false); }
}
function setStatus(ok, text) {
  const el = $("#reviewStatus"); el.className = "status-line" + (ok ? " ok" : ""); el.innerHTML = ok ? ico("circle-check") : ico("loader-circle"); el.append(text);
}
async function run() {
  if (S.busy) return;
  if (!S.live && !S.photoIsSample) { await useSample(); toast("Demo mode: using the sample photo"); }
  if (!S.photo) { toast("Add a photo first"); $("#stepPhoto").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  S.prompt = samPrompt($("#promptInput").value); S.shots = []; S.listing = null; S.cutoutWhite = null; S.cutCanvas = null;
  setBusy(true); setStage(2);
  drawPipe(); $("#pipeEmpty").classList.add("hidden"); $("#totalTime").textContent = "";
  $("#review").classList.remove("hidden"); $("#form").classList.add("is-loading"); setStatus(false, "Generating your listing…");
  $("#listingError").classList.add("hidden"); $("#warnings").classList.add("hidden");
  const T0 = performance.now();
  lastListingHint = [$("#hintInput").value.trim(), `Garment: ${S.prompt}`].filter(Boolean).join(". ");
  setShot("orig", "Original", S.photo, "01-original.jpg");
  setShot("cut", "Cut-out", "", "02-cutout.png", { loading: true });
  try {
    // Start everything that only needs the photo at once: listing text (server) ‖ segmentation (worker) ‖ flat-lay background (server).
    // FLUX occasionally returns a 5xx: retry once, then fall back to the bundled background (marked on the step).
    let sceneFallback = false;
    const pickScene = () => api("/api/scene", { scene: ["marble", "wood", "linen"][Math.floor(Math.random() * 3)] }).then((d) => d.image);
    const sceneP = S.provider === "workers-ai" ? pickScene().catch(() => pickScene()).catch(() => { sceneFallback = true; return "/demo/scene-marble.jpg"; })
      : S.provider === "demo" ? sleep(1200).then(() => "/demo/scene-marble.jpg") : null;
    sceneP?.catch(() => {});
    const sparkP = listingStep();
    const segP = segmentStep().then((cut) => {
      if (!cut) { setShot("cut", "Cut-out", "", "02-cutout.png", { error: "No garment found" }); return null; }
      S.cutoutWhite = cut.white; S.cutCanvas = cut.cut;
      setShot("cut", "Cut-out (PNG)", cut.png, "02-cutout.png", { check: true });
      return cut;
    }).catch((e) => { stepState("sam", "error", e.message.slice(0, 80)); stepState("cut", "skip", "Skipped"); setShot("cut", "Cut-out", "", "02-cutout.png", { error: "Cut-out failed" }); return null; });

    await segP;
    const shot = async (id, key, label, name, make) => {
      setShot(key, label, "", name, { loading: true }); stepState(id, "running");
      try { setShot(key, label, await make(), name); stepState(id, "done", id === "life" && sceneFallback ? "saved background" : ""); }
      catch (e) { setShot(key, label, "", name, { error: e.message.slice(0, 60) || "Failed" }); stepState(id, "error", e.message.slice(0, 80)); }
    };
    const base = S.cutoutWhite || S.photo;
    if (S.provider === "meta-api") {
      await Promise.all([sparkP, shot("studio", "studio", "Studio", "03-studio.jpg", () => museImage("studio", base)),
        shot("life", "life", "Lifestyle", "04-lifestyle.jpg", () => museImage("lifestyle", base))]);
    } else {
      const need = () => { if (!S.cutCanvas) throw new Error("Needs a cut-out"); return S.cutCanvas; };
      await Promise.all([sparkP,
        shot("studio", "studio", "Studio", "03-studio.jpg", async () => jpg(composeOn(need(), { bg: "#ffffff", scale: 0.8 }))),
        shot("life", "scene", "Flat-lay scene", "04-flatlay.jpg", async () => {
          const cut = need();
          return jpg(composeOn(cut, { bg: await loadImage(await sceneP), scale: 0.64, shadow: "flatlay" }));
        })]);
    }
    const total = (performance.now() - T0) / 1000, n = S.shots.filter((s) => s.src).length;
    $("#totalTime").textContent = `Total ${total.toFixed(1)}s${S.live ? "" : " (demo replay)"}, ${n} images`;
    if (!S.listing) { setStatus(false, "Images ready, listing text missing"); toast("Listing text failed. Use Try again.", 4000); setStage(2); }
    else { setStage(3); setStatus(true, `Ready in ${total.toFixed(1)}s. Check the details, then export.`); $("#review").scrollIntoView({ behavior: "smooth", block: "start" }); }
  } finally { setBusy(false); }
}

async function variant() {
  if (S.busy || !S.shots.length) return toast("Generate a listing first");
  const colour = $("#colourInput").value.trim() || "navy blue";
  const key = "var-" + colour.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const name = `05-variant-${key.slice(4)}.jpg`;
  S.busy = true; $("#variantBtn").disabled = true; $("#variantBtn").setAttribute("aria-busy", "true");
  setShot(key, `Variant: ${colour}`, "", name, { loading: true });
  try {
    let src, label = `Variant: ${colour}`;
    if (S.provider === "meta-api") src = await museImage("variant", S.cutoutWhite || S.photo, colour);
    else {
      const rgb = colourToRGB(colour); if (!rgb) throw new Error("Unknown colour. Try navy, maroon, olive, black or #1f3a5f");
      if (!S.cutCanvas) throw new Error("Needs a cut-out");
      const c = mkCanvas(S.cutCanvas.width, S.cutCanvas.height), g = c.getContext("2d"); g.drawImage(S.cutCanvas, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height); recolourPixels(d.data, rgb); g.putImageData(d, 0, 0);
      src = jpg(composeOn(c, { bg: "#ffffff", scale: 0.8 })); label = `${colour.replace(/^./, (m) => m.toUpperCase())} preview`;
    }
    setShot(key, label, src, name);
    if (S.listing && !S.listing.colours.some((c) => c.toLowerCase() === colour.toLowerCase())) { S.listing.colours.push(colour.replace(/\b\w/g, (m) => m.toUpperCase())); fillForm(); }
  } catch (e) { setShot(key, `Variant: ${colour}`, "", name, { error: e.message.slice(0, 60) }); toast(e.message, 4000); }
  finally { S.busy = false; $("#variantBtn").disabled = false; $("#variantBtn").setAttribute("aria-busy", "false"); }
}

// ---------- export / send ----------
function imagesForPack() { return S.shots.filter((s) => s.src).map((s) => ({ name: s.name, bytes: dataUrlBytes(s.src) })); }
function zipPack() {
  if (!S.listing) return toast("The listing is not ready yet");
  readForm();
  const z = buildListingPack(S.listing, imagesForPack(), { price: price(), sku: $("#skuInput").value.trim() });
  download(`vestire-listing-${slug()}.zip`, new Blob([z], { type: "application/zip" })); toast("Listing pack downloaded");
}
const slug = () => (S.listing?.title || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
function csv() { readForm(); download(`vestire-import-${slug()}.csv`, new Blob([vestireCSV(S.listing, { price: price(), sku: $("#skuInput").value.trim(), photos: S.shots.filter((s) => s.src).map((s) => s.name) })], { type: "text/csv" })); }
async function sendVestire() {
  readForm();
  const cfg = settings();
  if (!cfg.enabled) return toast("Turn on Send to Vestire in Settings first");
  if (!cfg.storeUrl || !cfg.user || !$("#storePass").value) { $("#settings").showModal(); return toast("Store URL, username and password are needed"); }
  if (!price()) return toast("Set a price first");
  if (!confirm(`Create a HIDDEN draft product “${S.listing.title}” at ${cfg.storeUrl}?`)) return;
  $("#sendBtn").disabled = true;
  try {
    const imgs = [];
    for (const s of S.shots.filter((x) => x.src && x.key !== "orig").slice(0, 4)) imgs.push(await downscale(s.src, 900, "image/jpeg", 0.82));
    const d = await api("/api/vestire", { storeUrl: cfg.storeUrl, username: cfg.user, password: $("#storePass").value, listing: S.listing, price: price(), sku: $("#skuInput").value.trim(), images: imgs });
    toast(`Hidden draft ${d.sku} created. Check your Vestire admin.`, 5000);
  } catch (e) { toast("Send failed: " + e.message, 5000); } finally { $("#sendBtn").disabled = false; }
}
function settings() { try { return JSON.parse(localStorage.getItem("vls-settings") || "{}"); } catch { return {}; } }
function applySettings() { const c = settings(); $("#sendToggle").checked = !!c.enabled; $("#storeUrl").value = c.storeUrl || ""; $("#storeUser").value = c.user || ""; $("#sendBtn").classList.toggle("hidden", !(c.enabled && S.vestireSend)); }

async function useSample() {
  S.photo = await urlToDataUrl("/demo/demo-input.jpg"); S.photoIsSample = true; showPreview();
  document.querySelectorAll(".chip").forEach((c) => { const on = c.dataset.p === "shirt"; c.classList.toggle("on", on); c.setAttribute("aria-pressed", on); }); $("#promptInput").value = "shirt";
}
function showPreview() {
  S.point = null; $("#pt")?.classList.add("hidden"); $("#preview").src = S.photo; $("#preview").classList.remove("hidden"); $("#dropEmpty").classList.add("hidden");
  $("#tapHint").classList.toggle("hidden", S.provider !== "workers-ai");
  S.photoKey++;
  // Precompute the SAM image embedding while the seller taps the garment and picks the type.
  if (S.provider === "workers-ai") embedPhoto(S.photoKey, S.photo).catch(() => {});
}
async function onFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Please choose an image file");
  if (!S.live) toast("Demo mode: your photo is shown, but the run replays the sample until an AI backend is connected", 4500);
  S.photo = await fileToDataUrl(file); S.photoIsSample = false; showPreview();
}
function modelStatus(st) {
  const el = $("#modelStatus"); if (!el || S.provider !== "workers-ai") return;
  el.classList.remove("hidden"); el.dataset.state = st.state;
  const t = el.querySelector(".txt"), u = el.querySelector("use");
  if (st.state === "loading") { u.setAttribute("href", "#i-loader-circle"); t.textContent = st.progress >= 100 ? "Preparing AI model" : st.progress ? `Loading AI model ${st.progress}%` : "Loading AI model"; }
  else if (st.state === "ready") { S.samReady = true; u.setAttribute("href", "#i-circle-check"); t.textContent = "AI model ready"; el.title = (st.cached ? "Loaded from browser cache" : "Downloaded and cached") + ` in ${secs(st.ms || 0)}`; }
  else if (st.state === "error") { u.setAttribute("href", "#i-triangle-alert"); t.textContent = "AI model unavailable"; el.title = st.error || ""; }
}

// ---------- boot ----------
async function boot() {
  try { const c = await (await fetch("/api/config")).json(); S.live = !!c.live; S.provider = c.provider || (c.live ? "meta-api" : "demo"); S.models = c.models || {}; S.vestireSend = c.vestireSend !== false; } catch { S.live = false; S.provider = "demo"; }
  drawPipe();
  const b = $("#modeBadge"); b.textContent = S.provider === "meta-api" ? "Live on Meta API" : S.provider === "workers-ai" ? "Live on open weights" : "Demo mode"; b.className = "pill mode " + (S.live ? "live" : "demo");
  $("#pipeSub").textContent = S.provider === "meta-api" ? "Powered by the Meta Model API: SAM 3.1, Muse Spark and Muse Image" : "Powered by Meta open-weight models: Llama 4 Scout and Segment Anything (SlimSAM)";
  $("#archMid").textContent = S.provider === "meta-api" ? "Meta Model API" : "Workers AI";
  $("#archSub").textContent = S.provider === "meta-api" ? "api.meta.ai/v1" : "Llama 4 Scout, FLUX.1";
  $("#preview").addEventListener("click", (e) => {
    const r = e.target.getBoundingClientRect(), im = e.target;
    S.point = { x: Math.round(((e.clientX - r.left) / r.width) * im.naturalWidth), y: Math.round(((e.clientY - r.top) / r.height) * im.naturalHeight) };
    const pt = $("#pt"); pt.style.left = (e.clientX - r.left + im.offsetLeft) + "px"; pt.style.top = (e.clientY - r.top + im.offsetTop) + "px"; pt.classList.remove("hidden");
    $("#tapHint").classList.add("hidden");
    toast("Point set. Segment Anything will cut out what you tapped.");
  });
  if (S.provider === "workers-ai") { onSamStatus(modelStatus); warmSam(); }
  $("#demoNote").classList.toggle("hidden", S.live);
  applySettings();
  $("#chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; document.querySelectorAll(".chip").forEach((x) => { x.classList.toggle("on", x === c); x.setAttribute("aria-pressed", x === c); }); $("#promptInput").value = c.dataset.p; });
  $("#fileInput").addEventListener("change", (e) => onFile(e.target.files[0]));
  $("#camInput").addEventListener("change", (e) => onFile(e.target.files[0]));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); onFile(e.dataTransfer.files[0]); });
  $("#sampleBtn").addEventListener("click", useSample);
  $("#goBtn").addEventListener("click", run);
  $("#variantBtn").addEventListener("click", variant);
  $("#zipBtn").addEventListener("click", zipPack);
  $("#csvBtn").addEventListener("click", csv);
  $("#waBtn").addEventListener("click", () => { readForm(); window.open("https://wa.me/?text=" + encodeURIComponent(waText()), "_blank", "noopener"); });
  $("#copyAllBtn").addEventListener("click", () => { readForm(); copyText(captionsText(S.listing)); });
  $("#sendBtn").addEventListener("click", sendVestire);
  $("#retryBtn").addEventListener("click", retryListing);
  $("#mobileAction").addEventListener("click", () => { if (S.stage === 3 && S.listing) zipPack(); else run(); });
  // Hide the sticky bar while the in-page primary button is on screen, so there is never a doubled action.
  if ("IntersectionObserver" in window) {
    const seen = new Set();
    const io = new IntersectionObserver((es) => { es.forEach((e) => e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)); $("#mobileBar").classList.toggle("off", seen.size > 0); });
    io.observe($("#goBtn")); io.observe($("#zipBtn"));
  }
  $("#review").addEventListener("input", (e) => { if (e.target.matches("[data-f], #sizeChart")) { readForm(); drawWarnings(); } if (e.target.matches("textarea")) grow(e.target); });
  document.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", () => {
    readForm(); const k = btn.dataset.copy;
    copyText(k === "social" ? `${S.listing.social_caption}\n\n${S.listing.hashtags.join(" ")}` : k === "whatsapp_text" ? waText() : S.listing[k]);
  }));
  $("#settingsBtn").addEventListener("click", () => $("#settings").showModal());
  $("#settings").addEventListener("close", () => {
    localStorage.setItem("vls-settings", JSON.stringify({ enabled: $("#sendToggle").checked, storeUrl: $("#storeUrl").value.trim(), user: $("#storeUser").value.trim() }));
    applySettings();
  });
  if (!S.live) await useSample();
}
boot();

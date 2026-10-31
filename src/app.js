// Vestire AI Listing Studio — browser app (bundled by tools/build.mjs).
import { parseSamText, pickBestMask, buildAlpha, alphaBBox, samPrompt } from "./lib/sam.js";
import { normalizeListing, findRiskyClaims, PRODUCT_TYPES } from "./lib/listing.js";
import { vestireCSV } from "./lib/csv.js";
import { buildListingPack, captionsText } from "./lib/pack.js";

const $ = (s) => document.querySelector(s);
const S = { live: false, models: {}, photo: null, photoIsSample: false, prompt: "shirt", listing: null, shots: [], cutoutWhite: null, busy: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------- pipeline view ----------
const STEPS = [
  { id: "sam", ico: "✂️", name: "SAM 3.1 · segment garment", sub: () => `Prompt “${S.prompt}” → box + mask` },
  { id: "cut", ico: "🧩", name: "Cut-out · mask applied in browser", sub: () => "@meta-sam/parser decodes the mask → canvas" },
  { id: "spark", ico: "🧠", name: "Muse Spark 1.3 · listing JSON", sub: () => "Vision + structured output (EN + Roman Urdu)" },
  { id: "studio", ico: "📸", name: "Muse Image 1.0 · studio shot", sub: () => "White background, ghost mannequin" },
  { id: "life", ico: "🌆", name: "Muse Image 1.0 · lifestyle shot", sub: () => "Model-style shot, Lahore setting" },
];
function drawPipe() {
  $("#pipe").innerHTML = "";
  for (const s of STEPS) {
    const li = document.createElement("li"); li.id = "p-" + s.id;
    li.innerHTML = `<span class="ix"></span><div><b></b><small></small></div><span class="st">waiting</span>`;
    li.querySelector(".ix").textContent = s.ico; li.querySelector("b").textContent = s.name; li.querySelector("small").textContent = s.sub();
    $("#pipe").append(li);
  }
}
const timers = {};
function stepState(id, state, extra = "") {
  const el = $("#p-" + id + " .st"); if (!el) return;
  clearInterval(timers[id]?.iv);
  el.className = "st " + (state === "running" ? "run" : state === "done" ? (S.live ? "done" : "demo") : state === "error" ? "err" : "skip");
  if (state === "running") {
    const t0 = performance.now(); timers[id] = { t0, iv: setInterval(() => { el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s"; }, 100) };
    el.textContent = "0.0s";
  } else if (state === "done") {
    const ms = timers[id] ? performance.now() - timers[id].t0 : 0;
    el.textContent = (S.live ? "✓ " : "✓ demo ") + (ms / 1000).toFixed(1) + "s" + (extra ? " · " + extra : "");
  } else el.textContent = state === "error" ? "✕ " + extra : extra || state;
}

// ---------- image helpers ----------
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Image load failed")); i.src = src; }); }
async function fileToDataUrl(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try { return await downscale(url, max); } finally { URL.revokeObjectURL(url); }
}
async function downscale(src, max = 1024, type = "image/jpeg", q = 0.86) {
  const img = await loadImage(src);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, q);
}
/** Applies a SAM mask to the photo: transparent PNG cut-out + square JPEG on white. */
async function makeCutout(photoUrl, samText) {
  const parsed = await parseSamText(samText);
  const best = pickBestMask(parsed.masks);
  if (!best) return { empty: true, parsed };
  const img = await loadImage(photoUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const alpha = buildAlpha(best, parsed.frame, W, H);
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H;
  const md = mc.getContext("2d").createImageData(W, H);
  for (let i = 0; i < alpha.length; i++) { md.data[i * 4 + 3] = alpha[i]; }
  mc.getContext("2d").putImageData(md, 0, 0);
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  g.drawImage(img, 0, 0); g.globalCompositeOperation = "destination-in"; g.filter = "blur(0.7px)"; g.drawImage(mc, 0, 0); g.filter = "none";
  const bb = alphaBBox(alpha, W, H, Math.round(Math.max(W, H) * 0.02)) || { x: 0, y: 0, w: W, h: H };
  const crop = document.createElement("canvas"); crop.width = bb.w; crop.height = bb.h;
  crop.getContext("2d").drawImage(c, bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
  const side = Math.round(Math.max(bb.w, bb.h) * 1.12);
  const sq = document.createElement("canvas"); sq.width = side; sq.height = side; const sg = sq.getContext("2d");
  sg.fillStyle = "#fff"; sg.fillRect(0, 0, side, side); sg.drawImage(crop, (side - bb.w) / 2, (side - bb.h) / 2);
  return { empty: false, parsed, best, png: crop.toDataURL("image/png"), white: sq.toDataURL("image/jpeg", 0.9), objects: parsed.masks.length };
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
    const f = document.createElement("figure");
    if (s.loading || s.error) { f.className = "shot loading"; f.textContent = s.error ? `${s.label}: ${s.error}` : `${s.label} — banaya ja raha hai…`; g.append(f); continue; }
    f.className = "shot" + (s.check ? " check" : "");
    const img = document.createElement("img"); img.src = s.src; img.alt = s.label; img.loading = "lazy";
    const cap = document.createElement("figcaption"); const sp = document.createElement("span"); sp.textContent = s.label;
    const a = document.createElement("a"); a.href = s.src; a.download = s.name; a.textContent = "⬇";
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
  $("#priceSug").textContent = p.min && p.max ? `Rs ${p.min.toLocaleString("en-PK")} – ${p.max.toLocaleString("en-PK")}` : "—";
  $("#priceNote").textContent = p.note;
  if (!$("#priceInput").value && p.min && p.max) $("#priceInput").placeholder = String(Math.round((p.min + p.max) / 2 / 50) * 50 - 1);
  drawWarnings();
}
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
  box.classList.remove("hidden"); box.textContent = "";
  const b = document.createElement("b"); b.textContent = "Check before publishing: "; box.append(b);
  box.append(w.map((x) => `“${x.text}” in ${x.field.replace(/_/g, " ")} (${x.label})`).join(" · "));
}
const price = () => Math.round(Number(String($("#priceInput").value || $("#priceInput").placeholder).replace(/[^0-9.]/g, "")) || 0);
function waText() { const p = price(); return S.listing.whatsapp_text.replace(/Rs\s*_{2,}/i, p ? `Rs ${p.toLocaleString("en-PK")}` : "Rs ____"); }
function copyText(t) { navigator.clipboard?.writeText(t).then(() => toast("Copy ho gaya ✓ Copied"), () => toast("Copy failed — select and copy manually")); }

// ---------- the run ----------
async function run() {
  if (S.busy) return;
  if (!S.live && !S.photoIsSample) { await useSample(); toast("Demo mode: using the sample photo"); }
  if (!S.photo) return toast("Pehle photo lagayein · Add a photo first");
  S.busy = true; $("#goBtn").disabled = true; $("#variantBtn").disabled = true;
  S.prompt = samPrompt($("#promptInput").value); S.shots = []; S.listing = null; S.cutoutWhite = null;
  drawPipe(); $("#review").classList.add("hidden"); $("#totalTime").textContent = "";
  const T0 = performance.now();
  setShot("orig", "Original", S.photo, "01-original.jpg");
  try {
    // SAM and Muse Spark run in parallel.
    const samP = (async () => {
      stepState("sam", "running");
      let text;
      if (S.live) text = (await api("/api/segment", { image: S.photo, prompt: S.prompt })).text;
      else { await sleep(900); text = await (await fetch("/demo/sam-sample.txt")).text(); }
      stepState("cut", "running");
      const cut = await makeCutout(S.photo, text);
      if (cut.empty) { stepState("sam", "done", "0 matches"); stepState("cut", "skip", "no garment found — try another word"); return null; }
      stepState("sam", "done", `${cut.objects} object${cut.objects > 1 ? "s" : ""}`);
      stepState("cut", "done");
      S.cutoutWhite = cut.white;
      setShot("cut", "Cut-out (PNG)", cut.png, "02-cutout.png", { check: true });
      return cut;
    })().catch((e) => { stepState("sam", "error", e.message.slice(0, 60)); stepState("cut", "skip", "skipped"); return null; });

    const sparkP = (async () => {
      stepState("spark", "running");
      let listing;
      if (S.live) listing = (await api("/api/listing", { image: S.photo, hint: $("#hintInput").value })).listing;
      else { await sleep(1700); listing = await (await fetch("/demo/listing-sample.json")).json(); }
      S.listing = normalizeListing(listing); stepState("spark", "done");
      fillForm(); $("#review").classList.remove("hidden");
    })().catch((e) => { stepState("spark", "error", e.message.slice(0, 60)); });

    await samP;
    const base = S.cutoutWhite || S.photo;
    const shot = async (id, kind, key, label, name, demoUrl) => {
      setShot(key, label, "", name, { loading: true }); stepState(id, "running");
      try {
        const src = S.live ? await museImage(kind, base) : (await sleep(kind === "studio" ? 1400 : 2100), await urlToDataUrl(demoUrl));
        setShot(key, label, src, name); stepState(id, "done");
      } catch (e) { setShot(key, label, "", name, { error: "failed" }); stepState(id, "error", e.message.slice(0, 60)); }
    };
    $("#review").classList.remove("hidden");
    await Promise.all([sparkP, shot("studio", "studio", "studio", "Studio", "03-studio.jpg", "/demo/demo-studio.jpg"), shot("life", "lifestyle", "life", "Lifestyle", "04-lifestyle.jpg", "/demo/demo-lifestyle.jpg")]);
    $("#totalTime").textContent = `Total ${((performance.now() - T0) / 1000).toFixed(1)}s${S.live ? "" : " (demo replay)"} · ${S.shots.filter((s) => s.src).length} images`;
    if (!S.listing) toast("Listing text failed — try again", 4000);
    else { $("#review").scrollIntoView({ behavior: "smooth", block: "start" }); }
  } finally { S.busy = false; $("#goBtn").disabled = false; $("#variantBtn").disabled = false; }
}

async function variant() {
  if (S.busy || !S.shots.length) return toast("Pehle listing banayein · Generate first");
  const colour = $("#colourInput").value.trim() || "navy blue";
  S.busy = true; $("#variantBtn").disabled = true;
  const key = "var-" + colour.toLowerCase().replace(/[^a-z]+/g, "-");
  const name = `05-variant-${key.slice(4)}.jpg`;
  setShot(key, `Variant: ${colour}`, "", name, { loading: true });
  try {
    let src;
    if (S.live) src = await museImage("variant", S.cutoutWhite || S.photo, colour);
    else { await sleep(1500); src = await urlToDataUrl("/demo/demo-variant-navy.jpg"); if (!/navy/i.test(colour)) toast("Demo has a saved navy sample only — live mode makes any colour", 4000); }
    setShot(key, S.live ? `Variant: ${colour}` : "Variant: navy (demo)", src, name);
    if (S.listing && !S.listing.colours.some((c) => c.toLowerCase() === colour.toLowerCase())) { S.listing.colours.push(colour.replace(/\b\w/g, (m) => m.toUpperCase())); fillForm(); }
  } catch (e) { setShot(key, `Variant: ${colour}`, "", name, { error: e.message.slice(0, 40) }); }
  finally { S.busy = false; $("#variantBtn").disabled = false; }
}

// ---------- export / send ----------
function imagesForPack() { return S.shots.filter((s) => s.src).map((s) => ({ name: s.name, bytes: dataUrlBytes(s.src) })); }
function zipPack() {
  if (!S.listing) return toast("Listing abhi tayyar nahi · not ready");
  readForm();
  const z = buildListingPack(S.listing, imagesForPack(), { price: price(), sku: $("#skuInput").value.trim() });
  download(`vestire-listing-${slug()}.zip`, new Blob([z], { type: "application/zip" })); toast("Listing pack downloaded ✓");
}
const slug = () => (S.listing?.title || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
function csv() { readForm(); download(`vestire-import-${slug()}.csv`, new Blob([vestireCSV(S.listing, { price: price(), sku: $("#skuInput").value.trim(), photos: S.shots.filter((s) => s.src).map((s) => s.name) })], { type: "text/csv" })); }
async function sendVestire() {
  readForm();
  const cfg = settings();
  if (!cfg.enabled) return toast("Settings mein “Send to Vestire” on karein");
  if (!cfg.storeUrl || !cfg.user || !$("#storePass").value) { $("#settings").showModal(); return toast("Store URL, username aur password chahiye"); }
  if (!price()) return toast("Pehle qeemat likhein · set a price");
  if (!confirm(`Create a HIDDEN draft product “${S.listing.title}” at ${cfg.storeUrl}?`)) return;
  $("#sendBtn").disabled = true;
  try {
    const imgs = [];
    for (const s of S.shots.filter((x) => x.src && x.key !== "orig").slice(0, 4)) imgs.push(await downscale(s.src, 900, "image/jpeg", 0.82));
    const d = await api("/api/vestire", { storeUrl: cfg.storeUrl, username: cfg.user, password: $("#storePass").value, listing: S.listing, price: price(), sku: $("#skuInput").value.trim(), images: imgs });
    toast(`Draft ban gaya ✓ ${d.sku} (hidden) — check Vestire admin`, 5000);
  } catch (e) { toast("Send failed: " + e.message, 5000); } finally { $("#sendBtn").disabled = false; }
}
function settings() { try { return JSON.parse(localStorage.getItem("vls-settings") || "{}"); } catch { return {}; } }
function applySettings() { const c = settings(); $("#sendToggle").checked = !!c.enabled; $("#storeUrl").value = c.storeUrl || ""; $("#storeUser").value = c.user || ""; $("#sendBtn").classList.toggle("hidden", !(c.enabled && S.vestireSend)); }

async function useSample() {
  S.photo = await urlToDataUrl("/demo/demo-input.jpg"); S.photoIsSample = true; showPreview();
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c.dataset.p === "shirt")); $("#promptInput").value = "shirt";
}
function showPreview() { $("#preview").src = S.photo; $("#preview").classList.remove("hidden"); $("#dropEmpty").classList.add("hidden"); }
async function onFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Sirf photo · images only");
  if (!S.live) toast("Demo mode: your photo is shown, but the run replays the sample until the Meta key is connected", 4500);
  S.photo = await fileToDataUrl(file); S.photoIsSample = false; showPreview();
}

// ---------- boot ----------
async function boot() {
  drawPipe();
  try { const c = await (await fetch("/api/config")).json(); S.live = !!c.live; S.models = c.models || {}; S.vestireSend = c.vestireSend !== false; } catch { S.live = false; }
  const b = $("#modeBadge"); b.textContent = S.live ? "LIVE · META" : "DEMO MODE"; b.className = "badge " + (S.live ? "live" : "demo");
  $("#demoNote").classList.toggle("hidden", S.live);
  applySettings();
  $("#chips").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c)); $("#promptInput").value = c.dataset.p; });
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
  $("#review").addEventListener("input", (e) => { if (e.target.matches("[data-f], #sizeChart")) { readForm(); drawWarnings(); } });
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

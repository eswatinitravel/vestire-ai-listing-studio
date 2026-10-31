// Server proxy (Cloudflare Pages advanced-mode Functions). The Meta key stays here as env.MODEL_API_KEY.
import { buildListingRequest, chatContent, extractJson, normalizeListing } from "../src/lib/listing.js";
import { samPrompt } from "../src/lib/sam.js";
import { sendToVestire } from "../src/lib/vestire.js";

export const MODELS = { sam: "sam-3.1", spark: "muse-spark-1.3", image: "muse-image-1.0" };
const MAX_IMAGE = 3_000_000; // data-URL chars (~2.2 MB)

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const base = (env) => (env.META_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
const hasKey = (env) => typeof env.MODEL_API_KEY === "string" && env.MODEL_API_KEY.length > 10;

export function imageOk(s) { return typeof s === "string" && s.length <= MAX_IMAGE && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]/.test(s); }

async function meta(env, path, body, fetchImpl) {
  return fetchImpl(`${base(env)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function upstreamError(r) {
  let msg = `Meta API ${r.status}`;
  try { const d = await r.json(); if (d?.error?.message) msg += `: ${d.error.message}`; } catch { /* ignore */ }
  return fail(msg, r.status === 429 ? 429 : 502);
}

/** SAM 3.1 text output from a Responses API body (non-streamed). */
export function responsesText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  let t = "";
  for (const o of body?.output || []) for (const c of o?.content || []) if (c?.type === "output_text" && typeof c.text === "string") t += c.text;
  return t;
}

export const IMAGE_PROMPTS = {
  studio: () => "Professional e-commerce product photo of exactly this garment, same colour, pattern, collar, buttons and cut. Neatly shaped on an invisible ghost mannequin, front view, pure white seamless background, soft even studio light, subtle shadow. No text, no logo, no watermark, no person.",
  lifestyle: () => "Lifestyle catalogue photo: a young Pakistani man wearing exactly this garment (same colour, pattern, collar and details), natural confident pose, modern Lahore street or cafe setting, warm daylight, shallow depth of field. Do not add any brand logo, text or watermark.",
  variant: (colour) => `Same garment, same studio product-photo style on pure white background, but recoloured to ${colour}. Keep the exact design, stitching, buttons and cut. No text, no logo, no watermark.`,
};
export function cleanColour(c) { return String(c || "").toLowerCase().replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 30) || "navy blue"; }

export async function handleApi(request, env = {}, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/config") {
    return json({ live: hasKey(env), models: MODELS, vestireSend: env.VESTIRE_SEND !== "off" });
  }
  if (request.method !== "POST") return fail("Method not allowed", 405);
  let b; try { b = await request.json(); } catch { return fail("Body must be JSON"); }
  const needKey = path !== "/api/vestire";
  if (needKey && !hasKey(env)) return fail("Live mode is off: MODEL_API_KEY is not set (demo mode only)", 503);
  const t0 = Date.now();

  if (path === "/api/segment") {
    if (!imageOk(b.image)) return fail("image must be a png/jpeg/webp data URL under ~2 MB");
    const prompt = samPrompt(b.prompt);
    const r = await meta(env, "/responses", {
      model: MODELS.sam,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: b.image }] }],
      metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    }, fetchImpl);
    if (!r.ok) return upstreamError(r);
    const text = responsesText(await r.json());
    return json({ model: MODELS.sam, prompt, text, ms: Date.now() - t0 });
  }

  if (path === "/api/listing") {
    if (!imageOk(b.image)) return fail("image must be a png/jpeg/webp data URL under ~2 MB");
    const r = await meta(env, "/chat/completions", buildListingRequest({ imageDataUrl: b.image, hint: b.hint, model: MODELS.spark }), fetchImpl);
    if (!r.ok) return upstreamError(r);
    const body = await r.json();
    let listing;
    try { listing = normalizeListing(extractJson(chatContent(body))); } catch (e) { return fail(`Muse Spark returned unreadable JSON: ${e.message}`, 502); }
    return json({ model: MODELS.spark, listing, ms: Date.now() - t0, usage: body.usage || null });
  }

  if (path === "/api/image") {
    if (!imageOk(b.image)) return fail("image must be a png/jpeg/webp data URL under ~2 MB");
    const kind = IMAGE_PROMPTS[b.kind] ? b.kind : null;
    if (!kind) return fail("kind must be studio, lifestyle or variant");
    const r = await meta(env, "/images/edits", {
      model: MODELS.image, prompt: IMAGE_PROMPTS[kind](cleanColour(b.colour)), images: [{ image_url: b.image }], n: 1,
      output_format: "jpeg", reasoning_strength: "low",
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    }, fetchImpl);
    if (!r.ok) return upstreamError(r);
    // Pass the (large) image JSON straight through without parsing it, to stay inside the free-plan CPU budget.
    return new Response(r.body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Model": MODELS.image, "X-Upstream-Ms": String(Date.now() - t0) } });
  }

  if (path === "/api/vestire") {
    if (env.VESTIRE_SEND === "off") return fail("Send to Vestire is disabled on this deployment", 403);
    if (!b.storeUrl || !b.username || !b.password) return fail("Store URL, username and password are required");
    try {
      const out = await sendToVestire(b, { fetchImpl, allowInsecure: env.ALLOW_INSECURE_STORE === "1" });
      return json({ ok: true, ...out, ms: Date.now() - t0 });
    } catch (e) { return fail(e.message, 502); }
  }
  return fail("Not found", 404);
}

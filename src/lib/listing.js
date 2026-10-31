// Muse Spark listing: schema, prompt, JSON extraction, normalisation and claim checks.
export const PRODUCT_TYPES = ["Shirts", "Polo Shirts", "T-Shirts", "Trousers", "Jeans", "Jackets", "Hoodies", "Other"];

export const LISTING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    category: { type: "string", enum: ["men", "women", "kids"] },
    product_type: { type: "string", enum: PRODUCT_TYPES },
    colours: { type: "array", items: { type: "string" } },
    style_tags: { type: "array", items: { type: "string" } },
    material_guess: { type: "string", description: "Always phrased as 'looks like ...'" },
    description_en: { type: "string" },
    description_roman_urdu: { type: "string" },
    social_caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    whatsapp_text: { type: "string" },
    size_chart: {
      type: "object",
      properties: {
        unit: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["unit", "columns", "rows"],
    },
    seo_title: { type: "string" },
    seo_description: { type: "string" },
    price_suggestion_pkr: {
      type: "object",
      properties: { min: { type: "integer" }, max: { type: "integer" }, note: { type: "string" } },
      required: ["min", "max", "note"],
    },
  },
  required: ["title", "category", "product_type", "colours", "style_tags", "material_guess", "description_en", "description_roman_urdu",
    "social_caption", "hashtags", "whatsapp_text", "size_chart", "seo_title", "seo_description", "price_suggestion_pkr"],
};

export const SYSTEM_PROMPT = `You write product listings for small Pakistani clothing sellers (men's western wear: shirts, polos, trousers, jackets) who sell on Instagram, Facebook, WhatsApp and their own web store.
Look at the photo and return ONLY the JSON object in the schema.
Rules:
- Describe only what is visible. Never state fabric, brand, origin or authenticity as fact. Use "looks like" for material (e.g. "looks like a cotton-blend oxford"). No brand names, no "original", "authentic", "branded", "imported", "100%".
- Title: short, searchable, no brand, max 70 characters.
- description_en: 2-3 short sentences. description_roman_urdu: same meaning in natural Roman Urdu (Urdu in Latin letters, e.g. "Yeh shirt rozana pehnne ke liye behtareen hai").
- social_caption: friendly Instagram/Facebook caption, max 2 emojis, English with a little Roman Urdu. hashtags: 8-12 tags starting with #, include #PakistaniFashion style local tags.
- whatsapp_text: short message a seller can forward to a customer, include "Price: Rs ____" placeholder if unsure.
- size_chart: typical Pakistani men's sizes (S, M, L, XL) in inches; columns e.g. ["Size","Chest","Length","Shoulder"] for tops or ["Size","Waist","Length","Inseam"] for trousers. Mark it as a suggestion in unit, e.g. "inches (suggested, measure your stock)".
- price_suggestion_pkr: realistic Pakistani market retail range in PKR for this kind of item from a small shop; note must say it is a suggestion only.
- seo_title max 60 chars, seo_description max 155 chars.`;

export function buildListingRequest({ imageDataUrl, hint = "", model = "muse-spark-1.3" }) {
  const userText = `Create the listing for the garment in this photo.${hint ? ` Seller note: ${String(hint).slice(0, 300)}` : ""}`;
  return {
    model,
    reasoning_effort: "low", // Muse Spark always reasons; "none" is rejected.
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: [{ type: "text", text: userText }, { type: "image_url", image_url: { url: imageDataUrl } }] },
    ],
    response_format: { type: "json_schema", json_schema: { name: "listing", schema: LISTING_SCHEMA } },
  };
}

/** Finds the JSON object in model text (handles code fences, leading prose, <think> blocks). */
export function extractJson(text) {
  if (text && typeof text === "object") return text;
  let s = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf("{");
  if (start < 0) throw new Error("No JSON object in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON object in model output");
}

/** Reads the assistant text from a chat-completions response body. */
export function chatContent(body) {
  const c = body?.choices?.[0]?.message?.content;
  if (Array.isArray(c)) return c.filter((p) => p && (p.type === "text" || p.type === "output_text")).map((p) => p.text).join("");
  return typeof c === "string" ? c : "";
}

const str = (v, max = 2000) => (v == null ? "" : String(v)).trim().slice(0, max);
const list = (v, max = 20) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((x) => str(x, 40)).filter(Boolean).slice(0, max);

export function normalizeListing(raw) {
  const r = raw || {};
  let min = Math.round(Number(r.price_suggestion_pkr?.min) || 0), max = Math.round(Number(r.price_suggestion_pkr?.max) || 0);
  if (min < 0) min = 0; if (max < 0) max = 0; if (min && max && min > max) [min, max] = [max, min];
  const tags = list(r.hashtags, 15).map((t) => "#" + t.replace(/^#+/, "").replace(/\s+/g, "")).filter((t) => t.length > 1);
  const sc = r.size_chart || {};
  const columns = list(sc.columns, 6);
  const rows = (Array.isArray(sc.rows) ? sc.rows : []).slice(0, 8).map((row) => (Array.isArray(row) ? row : [row]).map((c) => str(c, 20)));
  let material = str(r.material_guess, 120);
  if (material && !/^(looks|appears|seems)\b/i.test(material)) material = "looks like " + material.replace(/^(it is|made of|fabric:?)\s*/i, "");
  return {
    title: str(r.title, 90), category: ["men", "women", "kids"].includes(r.category) ? r.category : "men",
    product_type: PRODUCT_TYPES.includes(r.product_type) ? r.product_type : "Other",
    colours: list(r.colours, 6), style_tags: list(r.style_tags, 10), material_guess: material,
    description_en: str(r.description_en), description_roman_urdu: str(r.description_roman_urdu),
    social_caption: str(r.social_caption), hashtags: tags, whatsapp_text: str(r.whatsapp_text),
    size_chart: { unit: str(sc.unit, 60) || "inches (suggested)", columns, rows },
    seo_title: str(r.seo_title, 60), seo_description: str(r.seo_description, 155),
    price_suggestion_pkr: { min, max, note: str(r.price_suggestion_pkr?.note, 200) || "Suggestion only — set your own price." },
  };
}

const RISKY = [
  [/\b(original|authentic|genuine|branded|imported|export quality|first copy|master copy)\b/i, "brand/authenticity claim"],
  [/\b100\s*%/i, "100% claim"],
  [/\b(guaranteed|warranty)\b/i, "guarantee claim"],
];
const FABRIC = /\b(cotton|linen|silk|wool|polyester|denim|leather|lycra|viscose|rayon|cashmere)\b/i;

/** Returns human-readable warnings for claims the seller must verify before publishing. */
export function findRiskyClaims(listing) {
  const out = [];
  const fields = ["title", "description_en", "description_roman_urdu", "social_caption", "whatsapp_text", "seo_title", "seo_description"];
  for (const f of fields) {
    const t = String(listing?.[f] || "");
    for (const [re, label] of RISKY) { const m = t.match(re); if (m) out.push({ field: f, label, text: m[0] }); }
    const fm = t.match(FABRIC);
    if (fm) {
      const before = t.slice(Math.max(0, fm.index - 30), fm.index).toLowerCase();
      if (!/(looks like|look like|appears|seems|feel|jaisa|jaisi|lagta|lagti)/.test(before)) out.push({ field: f, label: "fabric stated as fact", text: fm[0] });
    }
  }
  return out;
}

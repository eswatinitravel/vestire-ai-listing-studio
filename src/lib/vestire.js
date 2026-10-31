// "Send to Vestire": creates a HIDDEN (active:false) draft product through the Vestire admin API
// (api/admin.js on branch vestire-cloudflare: login -> image_upload -> product_save). Runs server-side.
import { sizesOf } from "./csv.js";

export function buildVestireProduct(listing, { price, sku } = {}) {
  const p = Math.round(Number(price) || 0);
  if (!listing?.title) throw new Error("Title missing");
  if (p <= 0) throw new Error("Set a price first (Qeemat likhein)");
  return {
    name: String(listing.title).slice(0, 120), brand: "", cat: listing.category || "men", type: listing.product_type || "Other",
    price: p, old_price: null, cost: null, tag: "New",
    description: [listing.description_en, listing.description_roman_urdu].filter(Boolean).join("\n\n").slice(0, 3000),
    colors: (listing.colours || []).slice(0, 6), sku: sku ? String(sku).slice(0, 40) : undefined,
    active: false, // always a hidden draft — owner switches it on in admin
    variants: sizesOf(listing).map((size) => ({ size, color: "", qty: 0 })),
  };
}

export function checkStoreUrl(url, { allowInsecure = false } = {}) {
  let u; try { u = new URL(url); } catch { throw new Error("Store URL is not valid"); }
  const h = u.hostname;
  const local = h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(":") || h.endsWith(".internal");
  if (!allowInsecure && (u.protocol !== "https:" || local)) throw new Error("Store URL must be a public https:// address");
  return u.origin;
}

export async function sendToVestire({ storeUrl, username, password, listing, price, sku, images = [] }, { fetchImpl = fetch, allowInsecure = false } = {}) {
  const origin = checkStoreUrl(storeUrl, { allowInsecure });
  const product = buildVestireProduct(listing, { price, sku });
  const call = async (a, body, token) => {
    const r = await fetchImpl(`${origin}/api/admin?a=${a}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    let data = {}; try { data = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) throw new Error(`Vestire ${a}: ${data.error || r.status}`);
    return { data, headers: r.headers };
  };
  const login = await call("login", { username, password });
  const m = /vc_admin=([^;]+)/.exec(login.headers.get("set-cookie") || "");
  if (!m) throw new Error("Vestire login gave no session");
  const token = m[1];
  const image_ids = [];
  for (const img of images.slice(0, 6)) {
    if (!/^data:image\/(webp|jpeg|png);base64,/.test(img) || img.length > 1_400_000) continue;
    const { data } = await call("image_upload", { data: img }, token);
    if (data.id) image_ids.push(data.id);
  }
  const { data: saved } = await call("product_save", { ...product, image_ids }, token);
  return { id: saved.id, sku: saved.sku, active: saved.active, images: image_ids.length, adminUrl: `${origin}/admin/` };
}

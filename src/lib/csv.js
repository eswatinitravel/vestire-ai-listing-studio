// Vestire import sheet export. Columns match the admin template (TPL_HEAD in admin/admin.js, branch vestire-cloudflare).
export const VESTIRE_HEADERS = ["Name", "Brand", "Category", "Type", "Price", "Sale Price", "Cost", "Colour", "Sizes", "Qty", "SKU", "Description", "Photos", "Tag", "Active"];
const CAT = { men: "Men", women: "Women", kids: "Juniors" };

export function csvCell(v) {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; // block spreadsheet formula injection
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
export function toCSV(rows) { return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n"; }

export function sizesOf(listing) {
  const rows = listing?.size_chart?.rows || [];
  const s = rows.map((r) => String(r?.[0] || "").trim()).filter((x) => x && x.length <= 12 && !/^size$/i.test(x));
  return s.length ? s : ["S", "M", "L", "XL"];
}

/** One import row. Products go in HIDDEN (Active = No) so the owner reviews before they show in the store. */
export function listingToVestireRow(listing, { price, sku = "", photos = [] } = {}) {
  const p = Math.round(Number(price) || 0) || Math.round(((listing.price_suggestion_pkr?.min || 0) + (listing.price_suggestion_pkr?.max || 0)) / 2);
  const desc = [listing.description_en, listing.description_roman_urdu].filter(Boolean).join("\n\n");
  return [listing.title, "", CAT[listing.category] || "Men", listing.product_type || "", p || "", "", "", (listing.colours || []).join(", "),
    sizesOf(listing).join(","), 0, sku, desc, photos.join(", "), "New", "No"];
}

export function vestireCSV(listing, opts) { return toCSV([VESTIRE_HEADERS, listingToVestireRow(listing, opts)]); }

// "Download listing pack": ZIP with images, listing.json, Vestire CSV and ready-to-paste captions.
import { zipSync, strToU8 } from "fflate";
import { vestireCSV } from "./csv.js";

export function captionsText(l) {
  return [`TITLE\n${l.title}`, `DESCRIPTION (EN)\n${l.description_en}`, `TAFSEEL (Roman Urdu)\n${l.description_roman_urdu}`,
    `INSTAGRAM / FACEBOOK\n${l.social_caption}\n\n${(l.hashtags || []).join(" ")}`, `WHATSAPP\n${l.whatsapp_text}`,
    `SEO\n${l.seo_title}\n${l.seo_description}`,
    `PRICE SUGGESTION (PKR, suggestion only)\nRs ${l.price_suggestion_pkr?.min} – ${l.price_suggestion_pkr?.max}. ${l.price_suggestion_pkr?.note || ""}`].join("\n\n---\n\n") + "\n";
}

/** images: [{name, bytes: Uint8Array}] → Uint8Array zip */
export function buildListingPack(listing, images, { price, sku, generator = "Vestire AI Listing Studio" } = {}) {
  const files = {};
  const names = [];
  for (const im of images || []) { const n = `images/${im.name}`; files[n] = [im.bytes, { level: 0 }]; names.push(im.name); }
  files["listing.json"] = strToU8(JSON.stringify({ generator, created: new Date().toISOString(), price: price || null, sku: sku || null, listing, images: names }, null, 2));
  files["vestire-import.csv"] = strToU8(vestireCSV(listing, { price, sku, photos: names }));
  files["captions.txt"] = strToU8(captionsText(listing));
  files["README.txt"] = strToU8("Vestire admin > Products > Import: upload vestire-import.csv and the files in images/. Products import HIDDEN (Active = No) — review, then switch on.\nAI text and prices are suggestions; check fabric, sizes and price before publishing.\n");
  return zipSync(files);
}

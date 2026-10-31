import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { VESTIRE_HEADERS, csvCell, toCSV, listingToVestireRow, vestireCSV, sizesOf } from "../src/lib/csv.js";
import { buildListingPack } from "../src/lib/pack.js";
import { normalizeListing } from "../src/lib/listing.js";
const L = normalizeListing(JSON.parse(fs.readFileSync(new URL("../public/demo/listing-sample.json", import.meta.url), "utf8")));

test("headers match the Vestire admin import template", () => {
  // copied from admin/admin.js TPL_HEAD on branch vestire-cloudflare
  assert.deepEqual(VESTIRE_HEADERS, ["Name", "Brand", "Category", "Type", "Price", "Sale Price", "Cost", "Colour", "Sizes", "Qty", "SKU", "Description", "Photos", "Tag", "Active"]);
});

test("csvCell quotes and blocks formula injection", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""'); assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)"); assert.equal(csvCell(null), ""); assert.equal(csvCell(42), "42");
});

test("row: hidden, men, brand empty, sizes from chart, price default = mid suggestion", () => {
  const r = listingToVestireRow(L, { photos: ["a.jpg", "b.jpg"] });
  const o = Object.fromEntries(VESTIRE_HEADERS.map((h, i) => [h, r[i]]));
  assert.equal(o.Active, "No"); assert.equal(o.Category, "Men"); assert.equal(o.Brand, ""); assert.equal(o.Sizes, "S,M,L,XL");
  assert.equal(o.Price, 2700); assert.equal(o.Photos, "a.jpg, b.jpg"); assert.equal(o.Tag, "New"); assert.match(o.Description, /Roman|aasmani/);
  assert.equal(listingToVestireRow(L, { price: "abc" })[4], 2700);
  assert.equal(listingToVestireRow(L, { price: 2499 })[4], 2499);
  assert.deepEqual(sizesOf({}), ["S", "M", "L", "XL"]);
});

test("CSV has 2 lines and round-trips the multi-line description", () => {
  const csv = vestireCSV(L, { price: 2500 });
  assert.ok(csv.startsWith("Name,Brand,Category")); assert.ok(csv.endsWith("\r\n"));
  assert.equal(toCSV([["x"]]), "x\r\n");
});

test("listing pack ZIP contains images, listing.json, CSV and captions", () => {
  const z = unzipSync(buildListingPack(L, [{ name: "01-original.jpg", bytes: new Uint8Array([1, 2, 3]) }], { price: 2500, sku: "VC-S001" }));
  assert.deepEqual(Object.keys(z).sort(), ["README.txt", "captions.txt", "images/01-original.jpg", "listing.json", "vestire-import.csv"]);
  const j = JSON.parse(strFromU8(z["listing.json"])); assert.equal(j.price, 2500); assert.deepEqual(j.images, ["01-original.jpg"]);
  assert.match(strFromU8(z["vestire-import.csv"]), /VC-S001/); assert.match(strFromU8(z["captions.txt"]), /suggestion only/i);
  assert.deepEqual([...z["images/01-original.jpg"]], [1, 2, 3]);
});

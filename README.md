# Vestire AI Listing Studio

**One photo → a ready-to-sell listing for small Pakistani clothing sellers.**
Live: https://vestire-listing-studio.pages.dev

A shopkeeper photographs a shirt, polo, trouser or jacket on the counter (any background). In under a minute the app gives back:

- a clean **cut-out** (transparent PNG) of the garment
- a **studio shot** (white background, soft shadow) and a **flat-lay scene** with *their real garment*, not an AI copy
- a **colour-variant preview** (e.g. navy) on request
- **listing text**: title, category, colours, style tags, material guess (always "looks like…"), English description, **Roman Urdu** description, Instagram/Facebook caption + hashtags, WhatsApp message, suggested size chart, SEO title/description, and a **suggested PKR price range** (labelled as a suggestion)
- warnings for risky claims ("original", "100% cotton", stated fabric) before anything is published
- **Download listing pack** (ZIP: images, `listing.json`, `vestire-import.csv` in the Vestire admin import format, `captions.txt`), WhatsApp share, copy buttons
- optional **Send to Vestire**: creates the product as a *hidden draft* in the Vestire admin (off by default)

## Meta models used

| Step | Primary (free, live now) | Optional upgrade (`MODEL_API_KEY`) |
|---|---|---|
| Segmentation | **Segment Anything (SlimSAM-77, compressed Meta SAM, Apache-2.0)**, running **in the browser** via transformers.js, prompted by a tap (or image centre) | **SAM 3.1** (`sam-3.1`, Responses API) with a noun prompt ("shirt"); masks decoded with Meta's `@meta-sam/parser` |
| Vision → listing JSON | **Meta Llama 4 Scout 17B-16E (open weights)** on Cloudflare Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`), JSON-schema output; fallback **Llama 3.2 11B Vision** (`agree` licence prompt sent automatically) | **Muse Spark 1.3** (`muse-spark-1.3`, chat completions, structured output, `reasoning_effort: low`) |
| Extra shots | Canvas composition of the real cut-out (studio + colour-variant preview); flat-lay **background** from FLUX.1 schnell on Workers AI (not a Meta model, labelled as such) | **Muse Image 1.0** (`/v1/images/edits`): studio, lifestyle model shot, colour variant |

The deployed site runs the primary path (badge **LIVE · OPEN WEIGHTS**). If `MODEL_API_KEY` is set, the app switches to the Meta Model API path automatically (badge **LIVE · META API**). With neither, it runs **Demo mode**: a saved SAM 3.1-format mask and a saved listing go through the same parsing, cut-out and canvas code.

## Architecture

```
 Phone / laptop browser                              Cloudflare Pages (free)                 Models
 ┌──────────────────────────────┐   /api/listing    ┌───────────────────────────────┐  env.AI  ┌────────────────────────────┐
 │ photo → downscale (≤1024px)  │ ───────────────▶  │ _worker.js (advanced mode)    │ ───────▶ │ Workers AI: Llama 4 Scout  │
 │ SlimSAM (transformers.js,    │   /api/scene      │  • validates input            │          │ (fallback Llama 3.2 Vision)│
 │   WASM) → mask → canvas      │ ───────────────▶  │  • no keys in the browser     │ ───────▶ │ Workers AI: FLUX.1 schnell │
 │ studio / flat-lay / variant  │                   │  • normalises listing JSON    │          └────────────────────────────┘
 │ review form, warnings        │   (optional)      │                               │  Bearer  ┌────────────────────────────┐
 │ ZIP + CSV (fflate)           │ /api/segment,     │  MODEL_API_KEY (secret) ──────┼────────▶ │ api.meta.ai/v1: SAM 3.1,   │
 └──────────────────────────────┘ /api/image        │                               │          │ Muse Spark, Muse Image     │
              │  /api/vestire (opt-in)             │  login → image_upload →       │          └────────────────────────────┘
              └──────────────────────────────────▶ │  product_save(active:false) ──┼──▶ Vestire admin API (hidden draft)
                                                    └───────────────────────────────┘
```

Model weights for SlimSAM (~14 MB, quantised) download once from the Hugging Face CDN and are cached by the browser; the app warms the model while the user picks a photo.

## Code map

```
public/            index.html, app.css, demo/ (sample photo, saved SAM mask, saved listing, scene)
src/app.js         UI + pipeline orchestration (provider: workers-ai | meta-api | demo)
src/lib/sam.js     SAM 3.1 wire text → masks (@meta-sam/parser) → alpha map
src/lib/segment-browser.js  SlimSAM in the browser (transformers.js from jsDelivr)
src/lib/listing.js prompt, JSON schema, JSON extraction, normalisation, risky-claim checks
src/lib/compose.js colour maths + canvas composition (studio, flat-lay, recolour)
src/lib/csv.js     Vestire import row (headers = admin TPL_HEAD), CSV escaping incl. formula-injection guard
src/lib/pack.js    listing pack ZIP
src/lib/vestire.js Send-to-Vestire (hidden draft) + store-URL guard
worker/api.js      /api/config, /api/listing, /api/scene (Workers AI); /api/segment, /api/image (Meta API); /api/vestire
worker/index.js    static files (inlined) + routing
tools/             build.mjs, deploy.sh, dev.mjs (runs the built worker on Node), e2e.py (headless check)
test/              38 node:test unit tests (mask decoding, JSON parsing, CSV/ZIP, proxy routes, Workers AI fallbacks)
```

## Setup

```bash
npm install
npm test                 # 38 tests
npm run build            # → pages-dist/_worker.js + _routes.json
npm run dev              # local server on :8788 (demo mode unless META/AI configured)
CLOUDFLARE_API_TOKEN=… sh tools/deploy.sh   # direct upload to Pages project vestire-listing-studio
```

Cloudflare Pages project settings (already set on `vestire-listing-studio`):

- **Workers AI binding**: variable name `AI` (production + preview). This is all the primary path needs; it uses the account's free Workers AI allowance (10,000 neurons/day; one listing ≈ 60 neurons with Scout).
- Optional **secret** `MODEL_API_KEY` = a Meta Model API key (starts with `LLM_`). Setting it switches the app to SAM 3.1 + Muse Spark + Muse Image. Env changes apply on the next deployment.
- Optional `VESTIRE_SEND=off` hides/blocks Send to Vestire on a public demo.

## Honesty & safety rules

- Product text never states brand, authenticity or fabric as fact ("looks like…"); a checker flags risky words before export.
- Prices, size charts and material are labelled **suggestions**.
- Studio, flat-lay and variant images use the seller's **real** garment pixels; the variant is labelled "preview" because it is a recolour.
- Vestire products are always created **hidden** (`active:false`) and the CSV has `Active = No`.
- Send to Vestire is off by default; the staff password is sent once per send and never stored.

## Licences

SlimSAM / SAM: Apache-2.0 · transformers.js: Apache-2.0 · Llama 4 / Llama 3.2: Meta Llama community licences (used via Workers AI) · `@meta-sam/parser`: SAM License · fflate: MIT · FLUX.1 schnell: Apache-2.0.

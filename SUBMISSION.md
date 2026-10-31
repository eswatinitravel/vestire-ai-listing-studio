# Vestire AI Listing Studio

**Track:** Indie · **Live demo:** https://vestire-listing-studio.pages.dev

**Tagline:** *Ek photo. Poori listing.* One phone photo of a garment becomes a cut-out, studio and flat-lay shots, bilingual captions, a size chart and a store-ready import file, using Meta's open-weight models at zero cost.

## Inspiration
In Pakistan, thousands of small clothing sellers run their business from a shop counter and a phone. Selling online means hours every week clearing a corner for photos, removing backgrounds in three different apps, writing captions in English *and* Roman Urdu, guessing sizes and prices, and then typing it all again into a store. Most give up and post blurry WhatsApp photos. We run a small men's western-wear store (Vestire Collection) and wanted the tool we needed: one photo in, a listing out, in the language customers actually use.

## What it does
1. **Photo:** take or upload a photo on any background. Tap the garment if the shot is busy.
2. **Segment Anything** (Meta's SAM, as SlimSAM in the browser) cuts out the garment. The tap is the prompt; the shopkeeper's phone does the work with no upload and no cost.
3. **Meta Llama 4 Scout (open weights)** looks at the photo and returns structured JSON: title, type, colours, style tags, a material *guess* ("looks like…"), English and Roman Urdu descriptions, an Instagram/Facebook caption with hashtags, a WhatsApp message, a suggested size chart, SEO text and a **suggested** PKR price range.
4. **Shots:** the real garment on a studio white background, on a generated flat-lay scene (wood, marble, linen), and a colour-variant preview (navy, maroon, olive…).
5. **Review:** every field is editable, risky claims ("original", "100% cotton") are flagged, and copy buttons and a WhatsApp share are built in.
6. **Hand-off:** a ZIP listing pack (images + `listing.json` + a CSV in the exact Vestire admin import format) or **Send to Vestire**, which creates a *hidden draft* product the owner switches on.

A live **pipeline view** shows each model step, its status and its timing.

## How we built it
- **Frontend:** vanilla JS + canvas, mobile-first, Roman Urdu/English labels. SlimSAM runs through transformers.js (WASM). Masks become alpha maps, then cut-outs and compositions, all on canvas. fflate builds the ZIP in the browser.
- **Backend:** a Cloudflare Pages Function (advanced mode) proxies model calls, so no keys reach the browser. A **Workers AI binding** runs `@cf/meta/llama-4-scout-17b-16e-instruct` with a JSON schema. It falls back to Llama 3.2 11B Vision, accepting Meta's licence via the `agree` prompt. FLUX.1 schnell generates empty scene backgrounds.
- **Meta Model API path (built and tested with mocks):** SAM 3.1 noun-prompt segmentation, parsed with Meta's `@meta-sam/parser`; Muse Spark 1.3 structured listing; Muse Image 1.0 studio, lifestyle and variant edits. It turns on automatically when a `MODEL_API_KEY` is set.
- **Quality:** 38 unit tests cover SAM mask decoding (round-tripped through Meta's own codec), JSON extraction and normalisation, the CSV/ZIP export, the proxy routes, the Workers AI fallbacks and the colour maths. A headless end-to-end run checks desktop and a 390 px phone screen with zero JS errors.

## Challenges
- **Our Meta Model API account locked behind 2FA** two days before the deadline. We rebuilt the primary pipeline on Meta's **open-weight** models (Llama 4 Scout on Workers AI, SAM in the browser) and kept the Meta API path as a drop-in upgrade.
- Making AI copy **safe for a real shop**: no invented brands, fabrics or authenticity claims. We combined prompt rules, `looks like` normalisation and a claim checker.
- Keeping product photos **honest**: generated "model" images change the garment. We composite the seller's real pixels instead and label recolours as previews.
- Free-tier limits: images are downscaled in the browser, and large image responses are streamed through the function without parsing.

## Accomplishments
- A full listing in **about 30 s** (13–36 s in our headless-browser runs; older phones will be slower) at **zero cost** to the seller (one listing ≈ 60 Workers AI neurons; the free tier allows 10,000/day).
- In our test the SAM cut-out matched the true garment mask at **IoU 0.985**.
- Output that plugs straight into a real store (the Vestire import format, hidden drafts).

## What's next
- Batch mode: a whole rail of stock in one go, with an automatic SKU and size grid.
- Voice notes in Urdu for the seller's hints (fabric, price), transcribed on-device.
- Direct posting to Instagram/Facebook shops once API approval comes through.
- Switch on SAM 3.1 + Muse Image for model-style lifestyle shots when the Meta API key is restored.

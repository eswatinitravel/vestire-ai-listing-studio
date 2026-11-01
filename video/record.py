# Screen-record the LIVE site (desktop 1280x720@1.5x -> 1920x1080, mobile 390x844@2x) with Playwright recordVideo.
# Writes raw webm videos + marks.json (event timestamps, seconds since each page was created) into video/raw/.
import sys, os, json, time, zipfile, io, urllib.request, ssl
HERE = os.path.dirname(os.path.abspath(__file__)); PROJ = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PROJ, "tools")); from px import proxy_cfg, launch_kw
from playwright.sync_api import sync_playwright
U = "https://vestire-listing-studio.pages.dev"
RAW = os.path.join(HERE, "raw"); os.makedirs(RAW, exist_ok=True)
PHOTO = os.path.join(PROJ, "assets-src", "demo-input.jpg")
which = sys.argv[1] if len(sys.argv) > 1 else "both"
ctxssl = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE")) if os.environ.get("SSL_CERT_FILE") else None
HFCACHE = {}
def hf_route(route):  # sandbox proxy rejects browser HF fetches; fetch server-side and fulfil (real users hit HF directly)
    url = route.request.url
    try:
        if url not in HFCACHE:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120, context=ctxssl) as r:
                HFCACHE[url] = (r.status, r.read(), r.headers.get("Content-Type", "application/octet-stream"))
        st, body, ct = HFCACHE[url]
        route.fulfill(status=st, body=body, headers={"Content-Type": ct, "Access-Control-Allow-Origin": "*"})
    except urllib.error.HTTPError as e: route.fulfill(status=e.code, body=e.read(), headers={"Access-Control-Allow-Origin": "*"})

# visible tap ripple (headless video has no cursor)
TAP_JS = """
addEventListener('pointerdown', e => { const d = document.createElement('div');
 Object.assign(d.style, {position:'fixed', left:(e.clientX-22)+'px', top:(e.clientY-22)+'px', width:'44px', height:'44px', borderRadius:'50%',
  background:'rgba(45,212,191,.35)', border:'3px solid #2dd4bf', zIndex:99999, pointerEvents:'none', transition:'transform .6s, opacity .6s'});
 document.documentElement.appendChild(d); requestAnimationFrame(()=>{ d.style.transform='scale(1.8)'; d.style.opacity='0'; }); setTimeout(()=>d.remove(), 700); }, true);
"""
marks = {}
def run(p, b, name, vp, dpr, size, mobile):
    ctx = b.new_context(ignore_https_errors=True, viewport=vp, device_scale_factor=dpr, is_mobile=mobile, has_touch=mobile,
                        accept_downloads=True, record_video_dir=os.path.join(RAW, name), record_video_size=size)
    ctx.route("https://huggingface.co/**", hf_route); ctx.route("https://*.hf.co/**", hf_route)
    ctx.add_init_script(TAP_JS)
    pg = ctx.new_page(); T0 = time.time(); M = {}; errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    mark = lambda k: M.__setitem__(k, round(time.time() - T0, 2)) or print(name, k, M[k], flush=True)
    def smooth(sel, block="start", wait=1200):
        pg.evaluate("([s,b])=>document.querySelector(s).scrollIntoView({behavior:'smooth',block:b})", [sel, block]); pg.wait_for_timeout(wait)
    def tap(sel):
        box = pg.locator(sel).bounding_box(); x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.up()
    pg.goto(U + "/", wait_until="networkidle"); mark("loaded")
    pg.wait_for_function("document.querySelector('#modelStatus')?.dataset.state==='ready'", timeout=120000); mark("model_ready")
    pg.wait_for_timeout(1500); M["badge"] = pg.inner_text("#modeBadge")
    smooth("#stepPhoto", wait=1500); mark("photo_card")
    pg.set_input_files("#fileInput", PHOTO); pg.wait_for_timeout(1500); mark("uploaded")
    tap('.chip[data-p="shirt"]'); pg.wait_for_timeout(800)
    box = pg.locator("#preview").bounding_box()
    pg.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.45); mark("tapped"); pg.wait_for_timeout(2500)
    pg.fill("#hintInput", ""); pg.type("#hintInput", "Stock M and L", delay=70); pg.wait_for_timeout(1200); mark("hint_typed")
    smooth("#goBtn", block="center", wait=900)
    tap("#goBtn"); mark("generate")
    pg.wait_for_timeout(300); smooth("#pipeCard", block="start", wait=600); mark("pipe_shown")
    pg.wait_for_function("document.querySelector('#totalTime').textContent.length>0", timeout=240000, polling=200); mark("done")
    M["steps"] = pg.eval_on_selector_all("#pipe li", "els=>els.map(e=>e.querySelector('b').textContent+' => '+e.querySelector('.st').textContent)")
    M["total"] = pg.inner_text("#totalTime")
    smooth("#pipeCard", wait=2500); mark("pipe_hold_start")  # hold on timers (app auto-scrolls to review; bring pipeline back)
    mark("pipe_hold_end")
    smooth("#gallery", wait=2500); mark("gallery")
    pg.locator("#colourInput").scroll_into_view_if_needed(); pg.fill("#colourInput", ""); pg.type("#colourInput", "maroon", delay=90)
    tap("#variantBtn"); mark("variant_click")
    try: pg.wait_for_function("[...document.querySelectorAll('#gallery figure img')].filter(i=>i.complete&&i.naturalWidth).length>=5", timeout=20000)
    except Exception as e: M["variant_error"] = str(e)[:150]; pg.screenshot(path=os.path.join(RAW, name + "-variant-fail.png"))
    mark("variant_done")
    pg.evaluate("()=>{const g=document.querySelector('#gallery'); g.scrollTo({left:g.scrollWidth,behavior:'smooth'})}")
    smooth("#gallery", wait=2500); mark("variant_shown")
    M["shots"] = pg.eval_on_selector_all("#gallery figure img", "els=>els.map(e=>e.alt)")
    smooth('[data-f=title]', block="center", wait=1500); mark("form")
    t = pg.locator("[data-f=title]"); t.click(); pg.keyboard.press("End"); pg.keyboard.type(" Original", delay=110); mark("typed_original")
    pg.wait_for_timeout(300); smooth("#warnings", block="center", wait=2800); M["warning"] = pg.inner_text("#warnings"); mark("warning_shown")
    for _ in range(9): pg.keyboard.press("Backspace"); pg.wait_for_timeout(60)
    pg.wait_for_timeout(800); mark("warning_cleared")
    for sel in ["[data-f=description_en]", "[data-f=description_roman_urdu]", "[data-f=social_caption]", "#sizeChart"]:
        smooth(sel, block="center", wait=1700)
    mark("desc_end")
    smooth(".price", block="center", wait=2500); M["price"] = pg.inner_text("#priceSug"); mark("price")
    smooth(".actions", block="center", wait=1200)
    wa_url = None
    try:
        with ctx.expect_page(timeout=8000) as pi: tap("#waBtn")
        mark("wa_click"); pop = pi.value; wa_url = pop.url
        try: pop.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception: pass
        pop.wait_for_timeout(4000); wa_url = pop.url; mark("wa_popup_end"); M["wa_video"] = str(pop.video.path()) if pop.video else None; pop.close()
    except Exception as e: M["wa_error"] = str(e)[:200]
    M["wa_url"] = wa_url
    pg.bring_to_front(); pg.wait_for_timeout(600)
    with pg.expect_download() as d: tap("#zipBtn")
    mark("zip_click"); zpath = os.path.join(RAW, f"{name}-pack.zip"); d.value.save_as(zpath)
    z = zipfile.ZipFile(zpath); M["zip"] = sorted(z.namelist()); M["csv_head"] = z.read("vestire-import.csv").decode().splitlines()[:2]
    pg.wait_for_timeout(2200)
    pg.evaluate("window.scrollTo({top:0,behavior:'smooth'})"); pg.wait_for_timeout(1200)
    tap("#settingsBtn"); pg.wait_for_timeout(1200); mark("settings_open")
    tap("#sendToggle"); pg.wait_for_timeout(2500); mark("settings_toggled")
    tap("#sendToggle"); pg.wait_for_timeout(600); pg.keyboard.press("Escape"); pg.wait_for_timeout(1000); mark("end")
    M["errors"] = errs; M["video"] = str(pg.video.path())
    ctx.close(); marks[name] = M
    old = json.load(open(os.path.join(RAW, "marks.json"))) if os.path.exists(os.path.join(RAW, "marks.json")) else {}
    old[name] = M; json.dump(old, open(os.path.join(RAW, "marks.json"), "w"), indent=1, ensure_ascii=False)

with sync_playwright() as p:
    b = p.chromium.launch(**launch_kw(), proxy=proxy_cfg())
    if which in ("both", "m390"): run(p, b, "m390", {"width": 390, "height": 844}, 2, {"width": 780, "height": 1688}, True)
    if which in ("both", "desktop"): run(p, b, "desktop", {"width": 1280, "height": 720}, 1.5, {"width": 1920, "height": 1080}, False)
    b.close()
old = json.load(open(os.path.join(RAW, "marks.json"))) if os.path.exists(os.path.join(RAW, "marks.json")) else {}
old.update(marks); json.dump(old, open(os.path.join(RAW, "marks.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps(marks, indent=1, ensure_ascii=False))

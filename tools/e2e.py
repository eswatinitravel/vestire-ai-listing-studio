# Headless end-to-end check on desktop + 390px: run pipeline, variant, ZIP download, JS errors. Usage: python3 tools/e2e.py URL [outprefix]
import sys, json, zipfile, io, os, urllib.request, ssl
sys.path.insert(0, os.path.dirname(__file__)); from px import proxy_cfg, launch_kw
from playwright.sync_api import sync_playwright
U = sys.argv[1].rstrip("/"); pre = sys.argv[2] if len(sys.argv) > 2 else "/tmp/vls"
ctxssl = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE")) if os.environ.get("SSL_CERT_FILE") else None
def hf_route(route):  # sandbox proxy rejects browser HF fetches (405); fetch server-side and fulfil (real users hit HF directly)
    req = urllib.request.Request(route.request.url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctxssl) as r:
            route.fulfill(status=r.status, body=r.read(), headers={"Content-Type": r.headers.get("Content-Type", "application/octet-stream"), "Access-Control-Allow-Origin": "*"})
    except urllib.error.HTTPError as e: route.fulfill(status=e.code, body=e.read(), headers={"Access-Control-Allow-Origin": "*"})
res = {}
with sync_playwright() as p:
    local = U.startswith("http://localhost")
    b = p.chromium.launch(**launch_kw(), proxy=(dict(proxy_cfg(), bypass="localhost,127.0.0.1") if proxy_cfg() else None) if local else proxy_cfg())
    for name, vp in [("desktop", {"width": 1280, "height": 900}), ("m390", {"width": 390, "height": 844})]:
        ctx = b.new_context(ignore_https_errors=True, viewport=vp, accept_downloads=True)
        ctx.route("https://huggingface.co/**", hf_route); ctx.route("https://*.hf.co/**", hf_route)
        pg = ctx.new_page(); errs = []; cons = []
        pg.on("pageerror", lambda e: errs.append(str(e))); ctx.on("weberror", lambda e: errs.append("weberror " + str(e.error)))
        pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
        pg.goto(U + "/", wait_until="networkidle"); pg.wait_for_timeout(800); pg.screenshot(path=f"{pre}-{name}-empty.png", full_page=True)
        badge = pg.inner_text("#modeBadge")
        if pg.locator("#preview.hidden").count(): pg.click("#sampleBtn"); pg.wait_for_timeout(500)
        pg.click("#goBtn")
        pg.wait_for_function("document.querySelector('#totalTime').textContent.length>0", timeout=240000)
        st = pg.eval_on_selector_all("#pipe li", "els=>els.map(e=>e.querySelector('b').textContent+' => '+e.querySelector('.st').textContent)")
        shots = pg.eval_on_selector_all("#gallery figure img", "els=>els.map(e=>[e.alt,e.naturalWidth,e.naturalHeight])")
        title = pg.input_value("[data-f=title]")
        pg.fill("#priceInput", "2499"); pg.fill("#colourInput", "navy blue"); pg.click("#variantBtn")
        pg.wait_for_function("[...document.querySelectorAll('#gallery figure img')].length>=5", timeout=60000)
        with pg.expect_download() as d: pg.click("#zipBtn")
        z = zipfile.ZipFile(io.BytesIO(open(d.value.path(), "rb").read()))
        csv = z.read("vestire-import.csv").decode()
        overflow = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        for sel in ["#pipeCard", "#review"]:
            pg.locator(sel).scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.locator(sel).screenshot(path=f"{pre}-{name}-{sel[1:]}.png")
        pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(200); pg.screenshot(path=f"{pre}-{name}-top.png"); pg.screenshot(path=f"{pre}-{name}-full.png", full_page=True)
        res[name] = dict(badge=badge, steps=st, shots=shots, title=title, zip=sorted(z.namelist()), csv_line2=csv.splitlines()[1][:140], overflowX=overflow, pageErrors=errs, consoleErrors=cons)
        ctx.close()
    b.close()
print(json.dumps(res, indent=1, ensure_ascii=False))

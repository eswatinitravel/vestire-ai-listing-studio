# Headless end-to-end check: loads the app, runs the demo pipeline, opens review, downloads the ZIP. Usage: python3 tools/e2e.py URL [outprefix]
import sys, json, zipfile, io
from playwright.sync_api import sync_playwright
U = sys.argv[1].rstrip("/"); pre = sys.argv[2] if len(sys.argv) > 2 else "/tmp/vls"
res = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp in [("desktop", {"width": 1280, "height": 900}), ("m390", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp, accept_downloads=True, device_scale_factor=1)
        pg = ctx.new_page(); errs = []; cons = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
        pg.goto(U + "/", wait_until="networkidle")
        badge = pg.inner_text("#modeBadge")
        pg.click("#goBtn")
        pg.wait_for_function("document.querySelector('#totalTime').textContent.length>0", timeout=30000)
        st = pg.eval_on_selector_all("#pipe .st", "els=>els.map(e=>e.textContent)")
        shots = pg.eval_on_selector_all("#gallery figure img", "els=>els.map(e=>[e.alt,e.naturalWidth,e.naturalHeight])")
        title = pg.input_value("[data-f=title]")
        pg.fill("#priceInput", "2499")
        pg.fill("#colourInput", "navy blue"); pg.click("#variantBtn")
        pg.wait_for_function("[...document.querySelectorAll('#gallery figure img')].length>=5", timeout=15000)
        with pg.expect_download() as d: pg.click("#zipBtn")
        z = zipfile.ZipFile(io.BytesIO(open(d.value.path(), "rb").read()))
        csv = z.read("vestire-import.csv").decode()
        overflow = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        pg.screenshot(path=f"{pre}-{name}-full.png", full_page=True)
        pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=f"{pre}-{name}-top.png")
        res[name] = dict(badge=badge, steps=st, shots=shots, title=title, zip=sorted(z.namelist()), csv_line2=csv.splitlines()[1][:160], overflowX=overflow, pageErrors=errs, consoleErrors=cons)
        ctx.close()
    b.close()
print(json.dumps(res, indent=1))

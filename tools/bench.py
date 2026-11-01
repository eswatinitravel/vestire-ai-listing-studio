# Speed + freeze benchmark on desktop. Usage: python3 tools/bench.py URL [label] [warm_wait_s]
# Reports: total pipeline time (app's own "Total" line), per-step results, longest main-thread long task and
# longest gap between animation frames during the run (a frozen UI shows up as a multi-second gap).
import sys, json, os, time
sys.path.insert(0, os.path.dirname(__file__)); from px import proxy_cfg, launch_kw
from e2e_hf import hf_route
from playwright.sync_api import sync_playwright
U = sys.argv[1].rstrip("/"); label = sys.argv[2] if len(sys.argv) > 2 else "run"; warm = float(sys.argv[3]) if len(sys.argv) > 3 else 25; photo_wait = float(sys.argv[4]) if len(sys.argv) > 4 else 1.5
PROBE = """
window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push(e.duration))).observe({type:'longtask', buffered:true}); } catch(e) {}
window.__gap = 0; window.__gapOn = false; let last = performance.now();
(function f(t){ if (__gapOn) __gap = Math.max(__gap, t - last); last = t; requestAnimationFrame(f); })(performance.now());
"""
with sync_playwright() as p:
    local = U.startswith("http://localhost")
    b = p.chromium.launch(**launch_kw(), proxy=(dict(proxy_cfg(), bypass="localhost,127.0.0.1") if proxy_cfg() else None) if local else proxy_cfg())
    ctx = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 900})
    ctx.route("https://huggingface.co/**", hf_route); ctx.route("https://*.hf.co/**", hf_route)
    ctx.add_init_script(PROBE)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: print("console", m.type, m.text[:200]) if m.type in ("error","warning") else None)
    ctx.on("weberror", lambda e: errs.append("weberror " + str(e.error)))
    t0 = time.time(); pg.goto(U + "/", wait_until="networkidle")
    ready_s = None
    if pg.locator("#modelStatus").count():
        try: pg.wait_for_function("document.querySelector('#modelStatus')?.dataset.state==='ready'", timeout=int(warm * 1000) + 120000); ready_s = round(time.time() - t0, 1)
        except Exception as e: ready_s = "timeout"
    else: pg.wait_for_timeout(int(warm * 1000))
    if pg.locator("#preview.hidden").count(): pg.click("#sampleBtn")
    pg.wait_for_timeout(int(photo_wait * 1000))
    pg.evaluate("__lt.length=0; __gap=0; __gapOn=true")
    w0 = time.time(); pg.click("#goBtn")
    pg.wait_for_function("document.querySelector('#totalTime').textContent.length>0", timeout=240000, polling=100)
    wall = round(time.time() - w0, 1)
    coi = pg.evaluate("crossOriginIsolated"); r = pg.evaluate("({lt: Math.max(0,...__lt), ltSum: __lt.reduce((a,b)=>a+b,0), gap: __gap})")
    st = pg.eval_on_selector_all("#pipe li", "els=>els.map(e=>(e.querySelector('b')||e).textContent.trim()+' => '+e.querySelector('.st').textContent.trim())")
    print(json.dumps(dict(label=label, crossOriginIsolated=coi, samSub=pg.inner_text("#p-sam small"), lifeSub=pg.inner_text("#p-life small"), modelReady_s=ready_s, total=pg.inner_text("#totalTime"), wall_s=wall, longestLongTask_ms=round(r["lt"]), longTaskSum_ms=round(r["ltSum"]),
                          longestFrameGap_ms=round(r["gap"]), steps=st, errors=errs), indent=1, ensure_ascii=False))
    b.close()

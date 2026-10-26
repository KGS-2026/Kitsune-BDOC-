#!/usr/bin/env python3
"""probe2.py URL W H WAIT JS [png] [initjs]  -> like probe.py but runs INITJS before page scripts (seed localStorage)"""
import sys, json
from playwright.sync_api import sync_playwright
url, w, h, wait, expr = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
shot = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] != '-' else None
init = sys.argv[7] if len(sys.argv) > 7 else None
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9222")
    mob = w < 768
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, has_touch=mob, service_workers="block")
    if init: ctx.add_init_script(init)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(url, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(wait * 1000)
    try:
        print(json.dumps(pg.evaluate(expr), indent=1)[:6000])
    except Exception as e:
        print("EVAL ERR", e)
    if init and 'RELOAD' in sys.argv:
        pg.reload(wait_until="domcontentloaded"); pg.wait_for_timeout(25000)
        try: pg.evaluate(open("/root/bdoc-qa/after_reload_act.js").read())
        except Exception as e: print("ACT ERR", e)
        pg.wait_for_timeout(3000)
        try: print("AFTER RELOAD", json.dumps(pg.evaluate(open('/root/bdoc-qa/after_reload.js').read()), indent=1)[:4000])
        except Exception as e: print("RELOAD EVAL ERR", e)
    if shot:
        try:
            import base64
            cdp = ctx.new_cdp_session(pg)
            data = cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
            open(shot, "wb").write(base64.b64decode(data))
        except Exception as e: print("SHOT ERR", str(e)[:100])
    if errs: print("PAGEERRORS", errs)
    ctx.close()

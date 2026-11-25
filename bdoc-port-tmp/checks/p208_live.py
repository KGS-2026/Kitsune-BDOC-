"""p208 live check: prod loads clean on SW v196; IOC layer plots C2 rows from the new keyless legs."""
import json, time
from playwright.sync_api import sync_playwright

URL = "https://kgsbdoc.netlify.app/"
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
                          args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("response", lambda r: errs.append("HTTP %d %s" % (r.status, r.url[:150])) if r.status >= 400 else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE.error " + m.text) if m.type == "error" else None)
    pg.goto(URL, wait_until="domcontentloaded", timeout=90000)
    time.sleep(30)
    pre = pg.evaluate("""async () => ({
        sw: (await (await fetch('/service-worker.js',{cache:'no-store'})).text()).match(/bdoc-v\\d+/)[0],
        hasIOC: typeof loadIOCLayer, ents: window.V ? V.entities.values.length : -1 })""")
    print("PRE", json.dumps(pre))
    pg.evaluate("() => { layers.ioc = true; window.__iocDone = false; loadIOCLayer().then(()=>{window.__iocDone=true}); }")
    pg.wait_for_function("window.__iocDone === true", timeout=60000)
    res = pg.evaluate("""() => {
        const c2 = iocEnts.filter(e => /C2/.test(e.description && e.description.getValue ? e.description.getValue() : '')).length;
        const srcs = {}; iocEnts.forEach(e => { const d = e.description.getValue(); const m = d.match(/Source: ([^<]+)/); if (m) srcs[m[1]] = (srcs[m[1]]||0)+1; });
        return { iocEnts: iocEnts.length, c2, srcs, sources: window._iocSources,
                 log: (window.EventLog && EventLog.items ? EventLog.items.slice(-3) : null) };
    }""")
    print("IOC", json.dumps(res, indent=1)[:1500])
    b.close()
print("ERRORS", len(errs))
for e in errs[:15]: print("  ", e[:220])

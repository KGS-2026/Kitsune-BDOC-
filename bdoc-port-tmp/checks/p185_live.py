"""p185 live check: load prod, wait for OutageWatch, run fusion on a synthetic
official outage and read the verdict + GTA INFRA line."""
import json, time
from playwright.sync_api import sync_playwright

URL = "https://kgsbdoc.netlify.app/"
errs, navs = [], []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
                          args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE.error " + m.text) if m.type == "error" else None)
    pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
    pg.goto(URL, wait_until="domcontentloaded", timeout=90000)
    time.sleep(25)
    pg.wait_for_function("window.OutageWatch && window.OutageWatch.statuspage", timeout=60000)
    time.sleep(10)
    pg.wait_for_function("window.OutageWatch && window.OutageWatch.statuspage", timeout=60000)
    print("NAVS", navs)
    st = pg.evaluate("""() => { const ow = window.OutageWatch; return {
        pill: (document.querySelector('#bdocBuildPill')||{}).textContent,
        lazy: window.BDOC.LazyLoader._version,
        active: Object.keys(ow.active||{}),
        statuspage: ow.statuspage, newsOk: ow.newsOk,
        score: ow.score, hasFuse: typeof ow.fuse,
        ents: window.V && window.V.entities ? window.V.entities.values.length : -1
    }; }""")
    print("STATE", json.dumps(st))
    res = pg.evaluate("""async () => {
        const ow = window.OutageWatch;
        const w = { id: 'sp-cloudflare', name: 'Cloudflare', rx: /cloudflare/i, kind: 'CDN', lat: 37.78, lon: -122.39, hq: 'San Francisco CA', upstream: true };
        const a = ow.active[w.id] = { name: 'Cloudflare', kind: 'CDN', firstSeen: Date.now(), lastSeen: Date.now(), count: 1, official: true, titles: [{t:'OFFICIAL statuspage: synthetic test', u:'https://www.cloudflarestatus.com'}] };
        const t0 = Date.now();
        await ow.fuse(w, a);
        const f = a.fusion || null;
        const out = { ms: Date.now() - t0, cause: f && f.cause, confidence: f && f.confidence, why: f && f.why, nCand: f && f.candidates && f.candidates.length,
                      cands: f && f.candidates ? f.candidates.map(c => c.cause + ':' + c.weight) : null,
                      fusionNote: ow._fusionNote || null, lastFusion: ow.lastFusion || null, score: ow.score,
                      gta: (document.querySelector('#bdocThreatPill')||{}).textContent };
        if (a.ent) window.V.entities.remove(a.ent); delete ow.active[w.id];
        return out;
    }""")
    print("FUSE", json.dumps(res, indent=1)[:1500])
    b.close()
print("ERRORS", len(errs))
for e in errs[:15]: print("  ", e[:220])

import time
from playwright.sync_api import sync_playwright
bad = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome",
                          args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"])
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("response", lambda r: bad.append((r.status, r.url[:160])) if r.status >= 400 else None)
    pg.goto("https://kgsbdoc.netlify.app/", wait_until="domcontentloaded", timeout=90000)
    time.sleep(35)
    b.close()
for x in bad: print(x)

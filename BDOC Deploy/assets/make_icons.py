from PIL import Image
import os

base_dir = os.path.join(os.path.dirname(__file__), "..")
src = os.path.join(base_dir, "android-chrome-512x512.png")
assets = os.path.join(base_dir, "assets")
os.makedirs(assets, exist_ok=True)

img = Image.open(src).convert("RGBA")
img.save(os.path.join(assets, "icon.png"))

ico_sizes = [(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)]
img.save(os.path.join(assets, "icon.ico"), format="ICO", sizes=ico_sizes)

try:
    img.resize((1024,1024), Image.LANCZOS).save(os.path.join(assets, "icon.icns"), format="ICNS")
    icns = "ok"
except Exception as e:
    icns = f"fail: {e}"

for f in ["icon.png","icon.ico","icon.icns"]:
    p = os.path.join(assets, f)
    print(f"{f}: {os.path.getsize(p) if os.path.exists(p) else 'MISSING'} bytes")
print("icns:", icns)

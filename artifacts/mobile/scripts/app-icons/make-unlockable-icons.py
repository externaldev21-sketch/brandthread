"""Builds the Chrome and Brushed silver app icons from the real B mark.
Usage: python3 -I scripts/app-icons/make-unlockable-icons.py assets/images/app-icons assets/images/app-icons

Input: the existing monochrome icon (for the mark's bevel detail) and its
Android foreground (white mark on transparent = the exact shape).
Output (1024x1024): <name>.png (iOS/primary, opaque) and
<name>-android-foreground.png (mark only, transparent), per icon.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
mono = np.asarray(Image.open(f"{src}/monochrome.png").convert("L"), dtype=np.float32) / 255.0
fg = Image.open(f"{src}/monochrome-android-foreground.png").convert("RGBA")
fg_alpha = fg.getchannel("A")
H, W = fg_alpha.size[1], fg_alpha.size[0]

def bbox(mask, thr):
    ys, xs = np.where(mask > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

# The Android foreground draws the B inside the adaptive-icon safe zone, smaller
# than the B on the primary icon. Scale its exact shape up onto the primary B.
FG_BOX = bbox(np.asarray(fg_alpha), 128)
MONO_BOX = bbox((mono * 255).astype(int), 70)
big = fg_alpha.crop(FG_BOX).resize((MONO_BOX[2] - MONO_BOX[0], MONO_BOX[3] - MONO_BOX[1]), Image.LANCZOS)
canvas = Image.new("L", (W, H), 0)
canvas.paste(big, MONO_BOX[:2])
alpha = np.asarray(canvas, dtype=np.float32) / 255.0
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# Bevel detail from the monochrome icon, normalised inside the mark.
inside = alpha > 0.5
detail = mono.copy()
lo, hi = np.percentile(detail[inside], 2), np.percentile(detail[inside], 98)
detail = np.clip((detail - lo) / max(hi - lo, 1e-3), 0, 1)

def compose(metal, bg_rgb, name):
    metal = np.clip(metal, 0, 1)
    rgb = np.stack([metal * c for c in (1.0, 1.0, 1.02)], -1)
    rgb = np.clip(rgb, 0, 1)
    bg = np.ones((H, W, 3), np.float32) * (np.array(bg_rgb, np.float32) / 255.0)
    # Soft contact shadow under the mark, like the existing icons.
    shadow = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)), np.float32) / 255.0
    shadow = np.roll(shadow, 10, axis=0)
    bg = bg * (1 - 0.45 * shadow[..., None])
    a = alpha[..., None]
    out_rgb = rgb * a + bg * (1 - a)
    Image.fromarray((out_rgb * 255).astype(np.uint8), "RGB").save(f"{out}/{name}.png")
    # Android foreground: the same metal, scaled back into the safe zone, on transparent.
    metal_img = Image.fromarray((rgb * 255).astype(np.uint8), "RGB").crop(MONO_BOX).resize((FG_BOX[2] - FG_BOX[0], FG_BOX[3] - FG_BOX[1]), Image.LANCZOS)
    fg_out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fg_out.paste(metal_img, FG_BOX[:2])
    fg_out.putalpha(fg_alpha)
    fg_out.save(f"{out}/{name}-android-foreground.png")

# Chrome: mirror-polished bands (bright sky, dark horizon, bright floor), plus the bevel.
t = (yy - 250) / (790 - 250)
bands = 0.82 + 0.18 * np.cos(t * np.pi * 2.0) - 0.55 * np.exp(-((t - 0.52) ** 2) / 0.004) + 0.25 * np.exp(-((t - 0.18) ** 2) / 0.01)
chrome = 0.30 + 0.70 * np.clip(bands, 0, 1)
chrome = chrome * (0.55 + 0.45 * detail) + 0.25 * detail ** 6
compose(chrome, (8, 8, 9), "chrome")

# Brushed silver: fine horizontal grain on a soft vertical falloff, plus the bevel.
rng = np.random.default_rng(7)
grain = rng.normal(0, 1, (H, 1)).astype(np.float32)
grain = np.asarray(Image.fromarray(((grain - grain.min()) / (np.ptp(grain)) * 255).astype(np.uint8).repeat(W, 1)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0
grain = grain + 0.35 * rng.normal(0, 1, (H, W)).astype(np.float32) * 0.15
base = 0.78 - 0.18 * ((yy - 250) / 540)
brushed = base + 0.07 * (grain - 0.5)
brushed = brushed * (0.88 + 0.12 * np.clip(detail * 1.6, 0, 1)) + 0.10 * detail ** 6
compose(brushed, (38, 39, 42), "brushed-silver")
print("ok")

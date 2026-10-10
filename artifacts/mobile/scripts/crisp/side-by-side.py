#!/usr/bin/env python3
"""
Before/after strips for the crispness PRs, from two crisp-crawl runs.

  python3 scripts/crisp/side-by-side.py BEFORE_DIR AFTER_DIR OUT_DIR ROLE ROUTE [ROUTE...]

Each route becomes one image, left to right:
  BEFORE fresh · AFTER fresh · BEFORE demo · AFTER demo
taken from <dir>/shots/<role>-<mode>/<slug>.jpg (390x844 @3x), scaled to
half size so a strip stays readable on GitHub.
"""
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont


def slug(route):
    if route == '/':
        return 'index'
    return re.sub(r'[^\w.-]+', '_', route.lstrip('/').replace('(', '').replace(')', ''))


def main():
    before, after, out, role, *routes = sys.argv[1:]
    os.makedirs(out, exist_ok=True)
    w, h = 585, 1266
    pad, label_h = 12, 44
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    except OSError:
        font = ImageFont.load_default()
    for route in routes:
        cells = []
        for mode in ('fresh', 'demo'):
            for name, root in (('BEFORE', before), ('AFTER', after)):
                path = os.path.join(root, 'shots', f'{role}-{mode}', f'{slug(route)}.jpg')
                cells.append((f'{name} {mode}', Image.open(path).resize((w, h), Image.LANCZOS) if os.path.exists(path) else None))
        sheet = Image.new('RGB', (pad + len(cells) * (w + pad), label_h + h + pad), 'black')
        draw = ImageDraw.Draw(sheet)
        for i, (label, img) in enumerate(cells):
            x = pad + i * (w + pad)
            draw.text((x, 10), label, fill='white', font=font)
            if img:
                sheet.paste(img, (x, label_h))
        name = f'{role}-{slug(route)}.jpg'
        sheet.save(os.path.join(out, name), quality=85)
        print(os.path.join(out, name))


if __name__ == '__main__':
    main()

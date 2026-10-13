"""compose.py <before_dir> <after_dir> <out_png> <name> <frames,comma> [crop x0,y0,x1,y1 in css px] [scale]"""
import sys
from PIL import Image, ImageDraw, ImageFont
bd, ad, out, name, frames = sys.argv[1:6]
crop = tuple(int(v) * 2 for v in sys.argv[6].split(',')) if len(sys.argv) > 6 and sys.argv[6] != '-' else None
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 0.5
frames = frames.split(',')
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
except OSError:
    font = small = ImageFont.load_default()
rows = []
for label, d in (('Before (dev)', bd), ('After', ad)):
    ims = []
    for f in frames:
        fn = f'{d}/{name}-{f}.png' if f else f'{d}/{name}.png'
        im = Image.open(fn).convert('RGB')
        if crop: im = im.crop(crop)
        im = im.resize((int(im.width * scale), int(im.height * scale)))
        ims.append((f, im))
    rows.append((label, ims))
pad, head, cap = 16, 40, 30
w = pad + sum(im.width + pad for _, im in rows[0][1])
h = sum(head + cap + max(im.height for _, im in r) + pad for _, r in rows) + pad
o = Image.new('RGB', (w, h), (255, 255, 255))
dr = ImageDraw.Draw(o)
y = pad
for label, ims in rows:
    dr.text((pad, y), label, fill=(0, 0, 0), font=font)
    y += head
    x = pad
    for f, im in ims:
        dr.text((x, y), f or '', fill=(90, 90, 90), font=small)
        o.paste(im, (x, y + cap))
        x += im.width + pad
    y += cap + max(im.height for _, im in ims) + pad
o.save(out)

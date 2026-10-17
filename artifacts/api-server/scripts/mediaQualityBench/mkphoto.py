import sys, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np
W,H=3024,4032  # portrait as displayed
rng=np.random.default_rng(7)
y,x=np.mgrid[0:H,0:W].astype(np.float32)
# fabric-like weave texture + color gradient
weave=(np.sin(x*0.9)*np.sin(y*0.9))*18
r=120+80*np.sin(x/400)+weave; g=90+70*np.cos(y/500)+weave; b=140+60*np.sin((x+y)/700)+weave
img=np.stack([r,g,b],-1)
# zone plate block (resolution chart)
cx,cy,R=W*0.72,H*0.3,520
d2=(x-cx)**2+(y-cy)**2; m=d2<R*R
zp=127+127*np.cos(d2*math.pi/(2*R*1.6))
for c in range(3): img[...,c][m]=zp[m]
img+=rng.normal(0,6,img.shape)  # sensor noise
im=Image.fromarray(np.clip(img,0,255).astype(np.uint8))
d=ImageDraw.Draw(im)
font=lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",s)
yy=120
for s in [120,72,48,32,22,16,12]:
    d.text((120,yy),f"BRANDTHREAD {s}px — The quick brown fox jumps 0123456789",font=font(s),fill=(255,255,255)); yy+=int(s*1.6)
# 1px/2px line gratings
for i in range(0,600,2): d.line([(120+i,1400),(120+i,1900)],fill=(0,0,0))
for i in range(0,600,4): d.line([(800,1400+i),(1400,1400+i)],fill=(255,255,255),width=2)
# fine print block bottom
for row in range(40):
    d.text((120,2400+row*30),"stitch detail ✂ 4032×3024 12MP  "*4,font=font(20),fill=(240,230,200))
im=im.rotate(90,expand=True)  # store landscape like iPhone sensor
ex=Image.Exif(); ex[0x0112]=6; ex[0x010f]="Apple"; ex[0x0110]="iPhone 15 Pro"
im.save(sys.argv[1],quality=95,exif=ex.tobytes(),subsampling=0)

# Side-by-side crops "as shown full-screen on a 1290px-wide (3x) iPhone screen":
# each output is scaled to the screen width (what the phone does), then the
# same region is cut out at 1:1 screen pixels. Also a native 100% crop.
import sys, json, os, subprocess
from PIL import Image, ImageDraw, ImageFont
S=sys.argv[1]; OUT=sys.argv[2]; os.makedirs(OUT, exist_ok=True)
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
SCREEN_W=1290
def frame(path, t=3.0):
    if path.endswith(('.mp4','.mov')):
        png=path+f".f{t}.png"
        subprocess.run(["ffmpeg","-v","error","-y","-ss",str(t),"-i",path,"-frames:v","1",
          "-vf","zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv:d=error_diffusion,format=rgb24" if 'hlg' in path else "format=rgb24", png],check=True)
        return Image.open(png).convert("RGB")
    from PIL import ImageOps
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")
def screen(img):
    h=round(img.height*SCREEN_W/img.width)
    return img.resize((SCREEN_W,h), Image.LANCZOS)
def label(im, text):
    d=ImageDraw.Draw(im); d.rectangle([0,0,im.width,44],fill=(0,0,0)); d.text((12,6),text,font=font,fill=(255,255,255)); return im
def pair(name, before, after, box, title):
    b=screen(frame(before)); a=screen(frame(after))
    x,y,w,h=[int(v) for v in (box[0]*SCREEN_W, box[1]*b.height, box[2]*SCREEN_W, box[2]*SCREEN_W)]
    cb=b.crop((x,y,x+w,y+h)); ca=a.crop((x,round(box[1]*a.height),x+w,round(box[1]*a.height)+h))
    # Zoom 2x (nearest) so individual screen pixels — and the artifacts — are visible.
    cb=cb.resize((w*2,h*2),Image.NEAREST); ca=ca.resize((w*2,h*2),Image.NEAREST); w,h=w*2,h*2
    out=Image.new("RGB",(w*2+12,h),(255,255,255)); out.paste(label(cb,"BEFORE"),(0,0)); out.paste(label(ca,"AFTER"),(w+12,0))
    out.save(f"{OUT}/{name}.png", optimize=True); print(name, out.size)
B=f"{S}/out/before"; A=f"{S}/out/after"
# Fine text sits top-left of the photo; 9:16 crops are center crops, region chosen inside them.
pair("slideshow-3x4-text", f"{B}/slideshow_3x4.jpg", f"{A}/slideshow_3x4.jpg", (0.03,0.02,0.25), "")
pair("slideshow-9x16-zoneplate", f"{B}/slideshow_9x16.jpg", f"{A}/slideshow_9x16.jpg", (0.50,0.10,0.25), "")
pair("product-photo-gratings", f"{B}/product.jpg", f"{A}/product.jpg", (0.02,0.30,0.25), "")
pair("chat-photo-fineprint", f"{B}/chat.jpg", f"{A}/chat.jpg", (0.02,0.58,0.25), "")
pair("post-video-1080p-frame", f"{B}/post_video_1080p.mp4", f"{A}/post_video_1080p.mp4", (0.05,0.05,0.25), "")
pair("post-video-4k60-hdr-frame", f"{B}/post_video_4k60_hdr.mp4", f"{A}/post_video_4k60_hdr.mp4", (0.05,0.05,0.25), "")
pair("cover-video-frame", f"{B}/cover_video_1080p.mp4", f"{A}/cover_video_1080p.mp4", (0.05,0.05,0.25), "")
pair("avatar-video-frame", f"{B}/avatar_video_1080p.mp4", f"{A}/avatar_video_1080p.mp4", (0.05,0.05,0.25), "")
pair("post-video-1080p-edited-frame", f"{B}/post_video_1080p.mp4", f"{A}/post_video_1080p_edited.mp4", (0.05,0.05,0.25), "")

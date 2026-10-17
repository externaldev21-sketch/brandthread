import json, subprocess, sys, os
S=sys.argv[1]
from PIL import Image, ImageOps
SRC=None
def ssim_screen(f, ratio):
    """SSIM vs the original photo, both shown at 1290 px wide (a 3x iPhone screen)."""
    src=ImageOps.exif_transpose(Image.open(f"{S}/media/iphone_12mp.jpg")).convert("RGB")
    if ratio:
        W,H=src.size; rw,rh=ratio; cw,ch=W,round(W*rh/rw)
        if ch>H: ch=H; cw=round(H*rw/rh)
        src=src.crop(((W-cw)//2,(H-ch)//2,(W-cw)//2+cw,(H-ch)//2+ch))
    out=Image.open(f).convert("RGB")
    h=round(1290*out.height/out.width)
    src.resize((1290,h),Image.LANCZOS).save(f"{S}/out/_ref.png"); out.resize((1290,h),Image.LANCZOS).save(f"{S}/out/_cmp.png")
    r=subprocess.run(["ffmpeg","-i",f"{S}/out/_cmp.png","-i",f"{S}/out/_ref.png","-lavfi","[0:v]format=rgb24,format=gray[a];[1:v]format=rgb24,format=gray[b];[a][b]ssim","-f","null","-"],capture_output=True,text=True).stderr
    import re; return float(re.search(r"All:([0-9.]+)",r).group(1))
SETTINGS={
 "before":{"slideshow_3x4":"4 JPEG encodes (crop 0.92 → prep 0.8 → server q80 → ffmpeg -q:v 3, 4:2:0)",
           "slideshow_9x16":"4 JPEG encodes (crop 0.92 → prep 0.8 → server q80 → ffmpeg -q:v 3, 4:2:0)",
           "avatar":"3 encodes (picker 0.9 → prep 0.8 → server q80)","product":"4 encodes (0.9 → crop 0.92 → prep 0.8 → q80, 2048 cap)",
           "chat":"2 encodes (picker 0.85 → server q80, 2048 cap)"},
 "after":{"slideshow_3x4":"crop q1.0 → 1 server encode (q92 libjpeg 4:4:4, lanczos)","slideshow_9x16":"crop q1.0 → 1 server encode (q92 libjpeg 4:4:4, lanczos)",
          "avatar":"picker q1.0 → 1 server encode (q90 4:4:4)","product":"picker q1.0, crop q1.0 → 1 server encode (q90 4:4:4, 2160 wide)",
          "chat":"picker 0.9 → 1 server encode (q90 4:4:4, 2160 wide)"}}
RATIO={"slideshow_3x4":(3,4),"slideshow_9x16":(9,16),"avatar":(1,1),"product":(3,4),"chat":None}
CUR=None
def probe_img(f):
    w,h=Image.open(f).size
    side="before" if "/before/" in f else "after"
    k=os.path.basename(f).replace(".jpg","")
    desc=SETTINGS[side].get(k,"")
    ssim=ssim_screen(f,RATIO[k]) if k in RATIO else None
    return f"{w}x{h}", desc+(f"; **SSIM {ssim:.4f}**" if ssim else "")
def probe_vid(f):
    j=json.loads(subprocess.run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",f],capture_output=True,text=True).stdout)
    v=[s for s in j["streams"] if s["codec_type"]=="video"][0]
    a=[s for s in j["streams"] if s["codec_type"]=="audio"]
    n,d=map(int,v["avg_frame_rate"].split("/")); fps=round(n/d,2)
    br=int(j["format"]["bit_rate"])/1e6
    tr=v.get("color_transfer","?")
    aud=f", {a[0]['codec_name']} {int(a[0].get('sample_rate',0))//1000}kHz {int(a[0].get('bit_rate',0))//1000}k" if a else ", no audio"
    return f"{v['width']}x{v['height']}", f"{v['codec_name']} {fps:g}fps {br:.1f} Mb/s, {tr}{aud}"
def mb(n): return f"{n/1048576:.2f} MB"
B={r["path"]:r for r in json.load(open(f"{S}/out/before/results.json"))}
A={r["path"]:r for r in json.load(open(f"{S}/out/after/results.json"))}
names={"slideshow_3x4":"Threads slideshow 3:4 (12MP photo)","slideshow_9x16":"Threads slideshow 9:16 (12MP photo)",
 "avatar":"Avatar photo","product":"Product photo 3:4","chat":"Chat photo",
 "post_video_1080p":"Post video, 1080p30 H.264 clip, no edits","post_video_4k60_hdr":"Post video, 4K60 HEVC HLG clip",
 "carousel_video_1080p":"POST carousel video (3:4 crop)","cover_video_1080p":"Profile cover video","avatar_video_1080p":"Avatar video"}
rows=["| Path | Before: resolution | Before: quality | Before: size | After: resolution | After: quality | After: size |","|---|---|---|---|---|---|---|"]
for k,label in names.items():
    b=B[k]; a=A[k]
    fn=probe_vid if b["file"].endswith(".mp4") else probe_img
    br,bq=fn(b["file"]); ar,aq=fn(a["file"])
    if a.get("passthrough"): aq+=" — **original kept (remux only)**"
    rows.append(f"| {label} | {br} | {bq} | {mb(b['bytes'])} | {ar} | {aq} | {mb(a['bytes'])} |")
e=A.get("post_video_1080p_edited")
if e:
    ar,aq=probe_vid(e["file"]); rows.append(f"| Post video, 1080p30 clip **with** edits (re-encoded) | — | — | — | {ar} | {aq} | {mb(e['bytes'])} |")
for k in ["slideshow_3x4","slideshow_9x16"]:
    br=f"{Image.open(B[k]['thumb']).size[0]}x{Image.open(B[k]['thumb']).size[1]}"; ar=f"{Image.open(A[k]['thumb']).size[0]}x{Image.open(A[k]['thumb']).size[1]}"
    bq="ffmpeg -q:v 4"; aq="q88, lanczos"
    rows.append(f"| {names[k]} — grid thumbnail | {br} | {bq} | {mb(os.path.getsize(B[k]['thumb']))} | {ar} | {aq} | {mb(os.path.getsize(A[k]['thumb']))} |")
print("\n".join(rows))

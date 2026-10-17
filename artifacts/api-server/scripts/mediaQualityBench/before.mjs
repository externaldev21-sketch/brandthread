// Replays the PRE-change media pipelines (settings copied verbatim from the
// routes/client code) on the test media. Usage: node before.mjs <mediaDir> <outDir>
// Run with NODE_PATH pointing at api-server/node_modules for sharp.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(process.env.SHARP_FROM + "/");
const sharp = require("sharp");

const [media, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { maxBuffer: 1 << 26 });
const results = [];

// expo-image-manipulator / picker JPEG quality simulated with libjpeg at q*100.
const jpeg = (img, q) => img.jpeg({ quality: Math.round(q * 100) }).toBuffer();

// ── Thread slideshow photo 3:4 (and 9:16) ────────────────────────────────
async function slideshowBefore(ratio, W, H, name) {
  const src = join(media, "iphone_12mp.jpg");
  // 1) client applyCropRect: crop to ratio, upscale to ≥1080x1440 only if smaller, JPEG 0.92
  const m = await sharp(src).rotate().metadata();
  const [dw, dh] = m.orientation >= 5 ? [m.height, m.width] : [m.width, m.height];
  const [rw, rh] = ratio;
  let cw = dw, ch = Math.round((dw * rh) / rw);
  if (ch > dh) { ch = dh; cw = Math.round((dh * rw) / rh); }
  let b = await jpeg(sharp(src).rotate().extract({ left: Math.round((dw - cw) / 2), top: Math.round((dh - ch) / 2), width: cw, height: ch }), 0.92);
  // 2) client prepareImageForUpload: cap 2048 long edge, JPEG 0.8 (always re-encodes)
  b = await jpeg(sharp(b).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }), 0.8);
  // 3) server normalizeUploadedImage: sharp q80 cap 2048 (only kept if smaller or EXIF; take it)
  const n = await sharp(b).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const stored = n.length < b.length ? n : b;
  const inP = join(out, `${name}_in.jpg`); writeFileSync(inP, stored);
  // 4) compose-slideshow ffmpeg canvas, -q:v 3, default bicubic
  const o = join(out, `${name}.jpg`);
  ff("-i", inP, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`, "-frames:v", "1", "-q:v", "3", o);
  const t = join(out, `${name}_thumb.jpg`);
  ff("-i", o, "-vf", `scale=360:${Math.round((360 * H) / W)}:force_original_aspect_ratio=increase,crop=360:${Math.round((360 * H) / W)}`, "-frames:v", "1", "-q:v", "4", t);
  results.push({ path: name, file: o, thumb: t, encodes: 4 });
}

// ── Avatar photo (native editor ~ screen-res square, q0.9 → prep q0.8 → server q80) ──
async function avatarBefore() {
  const src = join(media, "iphone_12mp.jpg");
  // iOS UIImagePickerController edited image is limited to the crop box in
  // screen points (~ 1290px on a 3x phone for a full-width square crop at best;
  // typically 750-1080). Use 1080 to be generous to "before".
  let b = await jpeg(sharp(src).rotate().resize(1080, 1080, { fit: "cover" }), 0.9);
  b = await jpeg(sharp(b), 0.8);
  const o = join(out, "avatar.jpg");
  writeFileSync(o, await sharp(b).jpeg({ quality: 80 }).toBuffer());
  results.push({ path: "avatar", file: o, encodes: 3 });
}

// ── Product photo (picker q0.9 → crop 3:4 q0.92 → prep q0.8 2048 → server q80) ──
async function productBefore() {
  const src = join(media, "iphone_12mp.jpg");
  let b = await jpeg(sharp(src).rotate(), 0.9);
  const m = await sharp(b).metadata();
  const cw = m.width, ch = Math.min(m.height, Math.round((cw * 4) / 3));
  b = await jpeg(sharp(b).extract({ left: 0, top: Math.round((m.height - ch) / 2), width: cw, height: ch }), 0.92);
  b = await jpeg(sharp(b).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }), 0.8);
  const o = join(out, "product.jpg");
  writeFileSync(o, await sharp(b).jpeg({ quality: 80 }).toBuffer());
  results.push({ path: "product", file: o, encodes: 4 });
}

// ── Chat photo (picker q0.85 base64 → server normalize q80 2048) ──
async function chatBefore() {
  const src = join(media, "iphone_12mp.jpg");
  const b = await jpeg(sharp(src).rotate(), 0.85);
  const o = join(out, "chat.jpg");
  writeFileSync(o, await sharp(b).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer());
  results.push({ path: "chat", file: o, encodes: 2 });
}

// ── Videos ────────────────────────────────────────────────────────────────
function composeVideoBefore(clip, name) {
  const o = join(out, `${name}.mp4`);
  const t0 = Date.now();
  ff("-i", join(media, clip), "-filter_complex",
    "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,setpts=PTS/1[outv];[0:a]atempo=1,aformat=sample_rates=44100:channel_layouts=stereo[outa]",
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p",
    "-preset", "veryfast", "-crf", "20", "-maxrate", "8.5M", "-bufsize", "16M",
    "-c:a", "aac", "-movflags", "+faststart", o);
  results.push({ path: name, file: o, seconds: (Date.now() - t0) / 1000 });
}
function carouselVideoBefore(clip, name) {
  const o = join(out, `${name}.mp4`);
  // full-frame crop of a 9:16 source into the 3:4 canvas (centre crop)
  ff("-i", join(media, clip), "-vf", "crop=iw:iw*4/3,scale=1080:1440:flags=lanczos,setsar=1,fps=30,format=yuv420p",
    "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "21", "-maxrate", "8M", "-bufsize", "16M",
    "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", o);
  results.push({ path: name, file: o });
}
function crf28Before(clip, name, vf) {
  const o = join(out, `${name}.mp4`);
  ff("-i", join(media, clip), "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", o);
  results.push({ path: name, file: o });
}

await slideshowBefore([3, 4], 810, 1080, "slideshow_3x4");
await slideshowBefore([9, 16], 720, 1280, "slideshow_9x16");
await avatarBefore();
await productBefore();
await chatBefore();
composeVideoBefore("iphone_1080p30_h264.mov", "post_video_1080p");
composeVideoBefore("iphone_4k60_hevc_hlg.mov", "post_video_4k60_hdr");
carouselVideoBefore("iphone_1080p30_h264.mov", "carousel_video_1080p");
crf28Before("iphone_1080p30_h264.mov", "cover_video_1080p", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30");
crf28Before("iphone_1080p30_h264.mov", "avatar_video_1080p", "crop='min(iw,ih)':'min(iw,ih)',scale=480:480,fps=30");

for (const r of results) r.bytes = statSync(r.file).size;
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ path, bytes }) => ({ path, bytes }))));

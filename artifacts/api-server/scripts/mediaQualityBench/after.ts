// Runs the NEW pipelines using the real lib code from the branch.
// Usage (from artifacts/api-server): npx tsx scripts/mediaQualityBench/after.ts <mediaDir> <outDir>
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  canPassthrough, composeClipChain, hasZscale, isHdr, longEdgeFilter, outputFps, passthroughRemuxArgs,
  posterArgs, probeVideo, renderSilentRendition, sdrStage, videoCanvas, videoEncodeArgs, AVATAR_VIDEO_EDGE, AVATAR_VIDEO_MAXRATE,
} from "../../src/lib/mediaQuality";
import { SLIDE_CANVAS, encodeSlide, renderSlideBase } from "../../src/lib/slideRender";
import { normalizeUploadedImage } from "../../src/lib/productImageResize";

const [media, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { maxBuffer: 1 << 26 });
const results: any[] = [];
const src = join(media, "iphone_12mp.jpg");
const deviceJpeg = (img: sharp.Sharp, q: number) => img.jpeg({ quality: Math.round(q * 100) }).toBuffer();

async function centerCrop(ratio: [number, number]) {
  const m = await sharp(src).rotate().toBuffer({ resolveWithObject: true });
  const { width: dw, height: dh } = m.info;
  let cw = dw, ch = Math.round((dw * ratio[1]) / ratio[0]);
  if (ch > dh) { ch = dh; cw = Math.round((dh * ratio[0]) / ratio[1]); }
  return sharp(m.data).extract({ left: Math.round((dw - cw) / 2), top: Math.round((dh - ch) / 2), width: cw, height: ch });
}

async function slideshow(ratio: [number, number], key: string, name: string) {
  // client applyCropRect at native res, quality 1 → uploaded untouched → server render
  const uploaded = await deviceJpeg(await centerCrop(ratio), 1);
  const canvas = SLIDE_CANVAS[key];
  const { slide, thumb } = await encodeSlide(await renderSlideBase(uploaded, canvas), canvas);
  const f = join(out, `${name}.jpg`); writeFileSync(f, slide);
  const t = join(out, `${name}_thumb.jpg`); writeFileSync(t, thumb);
  results.push({ path: name, file: f, thumb: t, encodes: 2 });
}
async function serverImage(name: string, input: Buffer) {
  const stored = await normalizeUploadedImage(input, "image/jpeg");
  const f = join(out, `${name}.jpg`); writeFileSync(f, stored.buffer);
  results.push({ path: name, file: f });
}

async function composeVideo(clip: string, name: string) {
  const input = join(media, clip);
  const p = await probeVideo(input);
  const o = join(out, `${name}.mp4`);
  const t0 = Date.now();
  if (canPassthrough(p)) {
    ff(...passthroughRemuxArgs(input, o, p).slice(1));
    results.push({ path: name, file: o, passthrough: true, seconds: (Date.now() - t0) / 1000 });
    return;
  }
  await composeVideoEncoded(clip, name);
}
async function composeVideoEncoded(clip: string, name: string) {
  const input = join(media, clip);
  const p = await probeVideo(input);
  const canvas = videoCanvas([p]);
  const fps = outputFps([p]);
  const o = join(out, `${name}.mp4`);
  const t0 = Date.now();
  ff("-i", input, "-filter_complex",
    `[0:v]${composeClipChain(canvas, fps, { hdr: isHdr(p), zscale: await hasZscale() })},setpts=PTS/1[outv];[0:a]atempo=1,aformat=sample_rates=48000:channel_layouts=stereo[outa]`,
    "-map", "[outv]", "-map", "[outa]", ...videoEncodeArgs({ fps, outputSeconds: p.durationSeconds }), o);
  results.push({ path: name, file: o, seconds: (Date.now() - t0) / 1000 });
}

await slideshow([3, 4], "3:4", "slideshow_3x4");
await slideshow([9, 16], "9:16", "slideshow_9x16");
// Avatar: the native editor still bounds the crop (~1080 here, same as before); picked at q1.
await serverImage("avatar", await deviceJpeg(sharp(src).rotate().resize(1080, 1080, { fit: "cover" }), 1));
await serverImage("product", await deviceJpeg(await centerCrop([3, 4]), 1));
await serverImage("chat", await deviceJpeg(sharp(src).rotate(), 0.9));

await composeVideo("iphone_1080p30_h264.mov", "post_video_1080p");
await composeVideoEncoded("iphone_1080p30_h264.mov", "post_video_1080p_edited");
await composeVideo("iphone_4k60_hevc_hlg.mov", "post_video_4k60_hdr");
{
  const input = join(media, "iphone_1080p30_h264.mov");
  const p = await probeVideo(input); const fps = outputFps([p]);
  const o = join(out, "carousel_video_1080p.mp4");
  ff("-i", input, "-vf", ["crop=iw:iw*4/3", "scale=w='min(iw,1080)':h=-2:flags=lanczos", sdrStage(false, false), "setsar=1", `fps=${fps}`, "format=yuv420p"].join(","),
    ...videoEncodeArgs({ fps, outputSeconds: p.durationSeconds }), o);
  results.push({ path: "carousel_video_1080p", file: o });
}
await renderSilentRendition({ input: join(media, "iphone_1080p30_h264.mov"), output: join(out, "cover_video_1080p.mp4"), poster: join(out, "cover.jpg"), scale: longEdgeFilter(), posterOffset: 0.3 });
results.push({ path: "cover_video_1080p", file: join(out, "cover_video_1080p.mp4") });
await renderSilentRendition({ input: join(media, "iphone_1080p30_h264.mov"), output: join(out, "avatar_video_1080p.mp4"), poster: join(out, "avatar_v.jpg"), posterOffset: 0.1, maxrate: AVATAR_VIDEO_MAXRATE, scale: `crop='min(iw,ih)':'min(iw,ih)',scale=${AVATAR_VIDEO_EDGE}:${AVATAR_VIDEO_EDGE}:flags=lanczos` });
results.push({ path: "avatar_video_1080p", file: join(out, "avatar_video_1080p.mp4") });
{
  const o = join(out, "post_video_poster.jpg");
  ff(...posterArgs(join(out, "post_video_1080p.mp4"), o, 0.5).slice(1));
}

for (const r of results) r.bytes = statSync(r.file).size;
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ path, bytes, passthrough }) => ({ path, bytes, passthrough }))));

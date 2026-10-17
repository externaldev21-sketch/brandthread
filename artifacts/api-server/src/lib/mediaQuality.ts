/**
 * Full-quality media encoding — the one place every post/story/carousel
 * video encode and every slide render gets its settings from.
 *
 * Rules (Dev: "people post something on my app and their stuff's still nice"):
 *  - One server encode, no client re-encode before it.
 *  - Never upscale: the output canvas is only as big as the sharpest source
 *    needs (capped at 1080x1920); smaller clips are padded, not blown up.
 *  - Keep the source frame rate up to 60 fps.
 *  - HDR (iPhone HLG / PQ) is tone-mapped to SDR BT.709 so it doesn't come out
 *    washed out on SDR players.
 *  - A clip with no edits that is already H.264/HEVC SDR within the 1080p
 *    budget is stored as-is (faststart remux), never re-encoded.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Largest composed video canvas (9:16, TikTok/Reels delivery size). */
export const VIDEO_MAX_W = 1080;
export const VIDEO_MAX_H = 1920;
export const VIDEO_MAX_FPS = 60;
/** x264 constant quality — 18 is visually lossless for phone footage. */
export const VIDEO_CRF = 18;
/** Peak cap (VBV buffer = 2x); 12 Mbit/s keeps fast motion + grain clean at 1080p60. */
export const VIDEO_MAXRATE = "12M";
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_BITRATE = "192k";
/** A passthrough original must stay under this average bitrate to stream smoothly. */
export const PASSTHROUGH_MAX_BITRATE = 20_000_000;
/** JPEG quality for ffmpeg-rendered stills (mjpeg -q:v scale, 2 ≈ libjpeg q92+). */
export const STILL_JPEG_QV = 2;

export interface VideoProbe {
  codec: string;
  /** Display size (rotation applied). */
  width: number;
  height: number;
  fps: number;
  pixFmt: string;
  colorTransfer: string;
  colorPrimaries: string;
  /** Average total bitrate, bits/s (0 when unknown). */
  bitRate: number;
  durationSeconds: number;
  hasAudio: boolean;
  audioCodec: string | null;
}

function parseRate(value: unknown): number {
  const [n, d] = String(value ?? "").split("/").map(Number);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return d && Number.isFinite(d) && d > 0 ? n / d : n;
}

/** Pure: turn `ffprobe -show_streams -show_format -of json` output into a VideoProbe. */
export function parseProbe(json: unknown): VideoProbe {
  const data = (json ?? {}) as { streams?: Array<Record<string, any>>; format?: Record<string, any> };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition?.attached_pic));
  if (!video) throw new Error("No video stream");
  const audio = streams.find((s) => s.codec_type === "audio");
  const rotationTag = Number(video.tags?.rotate ?? 0);
  const sideRotation = Number(
    (video.side_data_list ?? []).find((d: any) => d.rotation !== undefined)?.rotation ?? 0,
  );
  const rotation = Math.abs((sideRotation || rotationTag) % 180) === 90;
  const w = Number(video.width) || 0;
  const h = Number(video.height) || 0;
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  const duration = Number(data.format?.duration ?? video.duration ?? 0);
  return {
    codec: String(video.codec_name ?? ""),
    width: rotation ? h : w,
    height: rotation ? w : h,
    fps: Number.isFinite(fps) ? fps : 0,
    pixFmt: String(video.pix_fmt ?? ""),
    colorTransfer: String(video.color_transfer ?? ""),
    colorPrimaries: String(video.color_primaries ?? ""),
    bitRate: Number(data.format?.bit_rate ?? video.bit_rate ?? 0) || 0,
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    hasAudio: !!audio,
    audioCodec: audio ? String(audio.codec_name ?? "") : null,
  };
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
  ], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  return parseProbe(JSON.parse(String(stdout)));
}

export function isHdr(p: Pick<VideoProbe, "colorTransfer" | "colorPrimaries">): boolean {
  return p.colorTransfer === "arib-std-b67" || p.colorTransfer === "smpte2084" ||
    p.colorPrimaries === "bt2020";
}

/** Round up to even (x264 4:2:0 needs even sides; rounding down would shave a clip). */
const even = (n: number) => Math.max(2, Math.ceil(n / 2) * 2);

/**
 * Output canvas for a composed 9:16 video: the smallest 9:16 box that shows
 * every source at its native resolution, capped at 1080x1920. A 720x1280
 * source stays 720x1280 (no upscale); 1080p and 4K sources get 1080x1920.
 */
export function videoCanvas(
  sources: Array<Pick<VideoProbe, "width" | "height">>,
  maxW = VIDEO_MAX_W,
  maxH = VIDEO_MAX_H,
): { w: number; h: number } {
  let needH = 0;
  for (const s of sources) {
    if (!(s.width > 0) || !(s.height > 0)) return { w: maxW, h: maxH };
    needH = Math.max(needH, s.height, (s.width * maxH) / maxW);
  }
  if (needH <= 0 || needH >= maxH) return { w: maxW, h: maxH };
  const h = Math.min(maxH, even(needH));
  return { w: Math.min(maxW, even((h * maxW) / maxH - 0.01)), h };
}

/** Keep the source frame rate (highest across clips), capped at 60. */
export function outputFps(sources: Array<Pick<VideoProbe, "fps">>): number {
  const best = Math.max(0, ...sources.map((s) => (Number.isFinite(s.fps) ? s.fps : 0)));
  if (best <= 0) return 30;
  return Math.min(VIDEO_MAX_FPS, Math.round(best * 1000) / 1000);
}

let zscaleAvailable: Promise<boolean> | null = null;
/** zscale (libzimg) gives a correct HLG/PQ → BT.709 conversion; not every ffmpeg build has it. */
export function hasZscale(): Promise<boolean> {
  zscaleAvailable ??= exec("ffmpeg", ["-hide_banner", "-filters"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
    .then(({ stdout }) => /\bzscale\b/.test(String(stdout)))
    .catch(() => false);
  return zscaleAvailable;
}

/** Filter chain that turns an HDR (HLG/PQ, BT.2020) frame into SDR BT.709. */
export function hdrToSdrFilter(zscale: boolean): string {
  return zscale
    // npl=100 (SDR reference white) + error-diffusion dither on the way back
    // to 8-bit, so gradients (skies, skin, backdrops) don't band.
    ? "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv:d=error_diffusion,format=yuv420p"
    // Fallback without libzimg: a matrix/primaries conversion (no tone curve,
    // but still far better than playing BT.2020 as BT.709).
    : "colorspace=all=bt709:iall=bt2020:fast=0,format=yuv420p";
}

/** Downscale-only fit into the canvas box (lanczos). Never enlarges. */
export function downscaleFilter(canvas: { w: number; h: number }): string {
  const { w, h } = canvas;
  return `scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
}

/**
 * Downscale-only cap on the long edge (orientation-aware), lanczos. Used by
 * single-video renditions (profile cover, product video) that keep their own
 * aspect ratio instead of a fixed canvas.
 */
export function longEdgeFilter(maxLongEdge = VIDEO_MAX_H): string {
  return `scale=w='if(gte(iw,ih),min(iw,${maxLongEdge}),-2)':h='if(gte(iw,ih),-2,min(ih,${maxLongEdge}))':flags=lanczos`;
}

/**
 * SDR 8-bit output stage. Tone-mapping runs AFTER the downscale: mapping a
 * 4K frame in float is ~2.5x slower than mapping the 1080p one, with no
 * visible difference.
 */
export function sdrStage(hdr: boolean, zscale: boolean): string {
  return hdr ? hdrToSdrFilter(zscale) : "format=yuv420p";
}

/** Per-clip chain for a composed 9:16 post: downscale-only fit → SDR → pad → fps. */
export function composeClipChain(
  canvas: { w: number; h: number },
  fps: number,
  opts: { hdr: boolean; zscale: boolean },
): string {
  return [
    downscaleFilter(canvas),
    sdrStage(opts.hdr, opts.zscale),
    `pad=${canvas.w}:${canvas.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${fps}`,
  ].join(",");
}

/**
 * x264 preset by work size: slow for normal-length posts, medium/faster only
 * when a long upload would otherwise blow the compose timeout (measured on a
 * 4-vCPU box: 1080p30 slow ≈ 11 fps, medium ≈ 22 fps, veryfast ≈ 56 fps).
 * CRF holds the quality target either way; slower presets just spend fewer
 * bits for it.
 */
export function x264Preset(outputSeconds: number, fps: number): "slow" | "medium" | "faster" {
  const frames = outputSeconds * fps;
  if (frames <= 60 * 30) return "slow"; // ≤ 60 s at 30 fps / 30 s at 60 fps
  if (frames <= 5 * 60 * 30) return "medium";
  return "faster";
}

/** Video + audio encoder args for every composed post/story/carousel video. */
export function videoEncodeArgs(opts: { fps: number; outputSeconds: number; audio?: boolean; maxrate?: string }): string[] {
  const { fps, outputSeconds, audio = true, maxrate = VIDEO_MAXRATE } = opts;
  const gop = Math.max(1, Math.round(fps * 2));
  return [
    "-c:v", "libx264", "-profile:v", "high", "-level:v", fps > 30 ? "4.2" : "4.1",
    "-pix_fmt", "yuv420p",
    "-preset", x264Preset(outputSeconds, fps), "-crf", String(VIDEO_CRF),
    "-maxrate", maxrate, "-bufsize", `${Number.parseFloat(maxrate) * 2}M`,
    "-g", String(gop), "-keyint_min", String(Math.max(1, Math.round(fps))),
    "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
    ...(audio ? ["-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", String(AUDIO_SAMPLE_RATE)] : ["-an"]),
    "-movflags", "+faststart",
  ];
}

/**
 * A clip can be stored as uploaded (remuxed for faststart, never re-encoded)
 * when nothing about the picture has to change: H.264 or HEVC, SDR 8-bit,
 * no larger than the 1080x1920 budget, ≤ 60 fps and a streamable bitrate.
 */
export function canPassthrough(p: VideoProbe): boolean {
  const codecOk = p.codec === "h264" || p.codec === "hevc";
  const sdr = !isHdr(p) && (p.pixFmt === "yuv420p" || p.pixFmt === "yuvj420p");
  const sizeOk = Math.min(p.width, p.height) <= VIDEO_MAX_W && Math.max(p.width, p.height) <= VIDEO_MAX_H;
  const fpsOk = p.fps > 0 && p.fps <= VIDEO_MAX_FPS + 0.5;
  const rateOk = p.bitRate > 0 && p.bitRate <= PASSTHROUGH_MAX_BITRATE;
  const audioOk = !p.hasAudio || p.audioCodec === "aac";
  return codecOk && sdr && sizeOk && fpsOk && rateOk && audioOk;
}

/** Remux args: copy streams, moov first, drop GPS/metadata, tag HEVC for Apple players. */
export function passthroughRemuxArgs(input: string, output: string, p: VideoProbe): string[] {
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c", "copy", "-map_metadata", "-1",
    ...(p.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    "-movflags", "+faststart", output,
  ];
}

/** Poster/cover frame: full output resolution, high-quality JPEG, HDR mapped. */
export function posterArgs(input: string, output: string, offsetSeconds: number, opts: { hdr?: boolean; zscale?: boolean } = {}): string[] {
  const vf = opts.hdr ? [hdrToSdrFilter(!!opts.zscale)] : [];
  return [
    "-y", "-ss", String(offsetSeconds), "-i", input, "-frames:v", "1",
    ...(vf.length ? ["-vf", vf.join(",")] : []),
    "-q:v", String(STILL_JPEG_QV), output,
  ];
}

/**
 * Silent single-video rendition (profile cover, product video, avatar video):
 * keeps source fps (≤ 60), tone-maps HDR, CRF 18, plus a full-res poster.
 * `scale` must be a downscale-only (or fixed-size, for avatars) scale filter.
 */
export async function renderSilentRendition(opts: {
  input: string;
  output: string;
  poster: string;
  scale: string;
  /** Extra args placed before `-i` (e.g. a trim's -ss/-t). */
  inputArgs?: string[];
  posterOffset: number;
  timeoutMs?: number;
  /** Peak bitrate cap (default VIDEO_MAXRATE). */
  maxrate?: string;
}): Promise<void> {
  const probe = await probeVideo(opts.input);
  const hdr = isHdr(probe);
  const fps = outputFps([probe]);
  const vf = [opts.scale, sdrStage(hdr, hdr && await hasZscale()), `fps=${fps}`].join(",");
  await exec("ffmpeg", [
    "-y", ...(opts.inputArgs ?? []), "-i", opts.input,
    "-vf", vf,
    ...videoEncodeArgs({ fps, outputSeconds: probe.durationSeconds, audio: false, maxrate: opts.maxrate }),
    opts.output,
  ], { timeout: opts.timeoutMs ?? 10 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  await exec("ffmpeg", posterArgs(opts.output, opts.poster, opts.posterOffset),
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
}

/** Avatar video edge (px). Square, matches the 800x800 avatar photo minimum. */
export const AVATAR_VIDEO_EDGE = 800;
/** An 800x800 loop never needs the full-screen peak rate. */
export const AVATAR_VIDEO_MAXRATE = "6M";

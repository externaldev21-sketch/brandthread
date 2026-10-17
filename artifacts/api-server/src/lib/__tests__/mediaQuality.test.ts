import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIO_SAMPLE_RATE,
  VIDEO_CRF,
  canPassthrough,
  composeClipChain,
  hasZscale,
  isHdr,
  outputFps,
  parseProbe,
  passthroughRemuxArgs,
  posterArgs,
  probeVideo,
  renderSilentRendition,
  longEdgeFilter,
  videoCanvas,
  videoEncodeArgs,
  x264Preset,
  type VideoProbe,
} from "../mediaQuality";

const probe = (over: Partial<VideoProbe> = {}): VideoProbe => ({
  codec: "h264", width: 1080, height: 1920, fps: 30, pixFmt: "yuv420p",
  colorTransfer: "bt709", colorPrimaries: "bt709", bitRate: 15_000_000,
  durationSeconds: 8, hasAudio: true, audioCodec: "aac", ...over,
});

describe("videoCanvas — never upscales", () => {
  it("keeps a 720x1280 source at 720x1280", () => {
    expect(videoCanvas([{ width: 720, height: 1280 }])).toEqual({ w: 720, h: 1280 });
  });
  it("gives 1080p and 4K sources a 1080x1920 canvas", () => {
    expect(videoCanvas([{ width: 1080, height: 1920 }])).toEqual({ w: 1080, h: 1920 });
    expect(videoCanvas([{ width: 2160, height: 3840 }])).toEqual({ w: 1080, h: 1920 });
  });
  it("sizes the canvas for the sharpest clip in a mix", () => {
    expect(videoCanvas([{ width: 720, height: 1280 }, { width: 1080, height: 1920 }])).toEqual({ w: 1080, h: 1920 });
  });
  it("letterboxes landscape 1080p into the full canvas (shown at native 1080 width)", () => {
    expect(videoCanvas([{ width: 1920, height: 1080 }])).toEqual({ w: 1080, h: 1920 });
  });
  it("keeps a small landscape clip small", () => {
    const c = videoCanvas([{ width: 640, height: 360 }]);
    expect(c).toEqual({ w: 642, h: 1138 });
    expect(c.w).toBeGreaterThanOrEqual(640);
  });
});

describe("outputFps — keeps source rate up to 60", () => {
  it("keeps 60 and 59.94", () => {
    expect(outputFps([probe({ fps: 60 })])).toBe(60);
    expect(outputFps([probe({ fps: 60000 / 1001 })])).toBeCloseTo(59.94, 2);
  });
  it("caps 120/240 fps slo-mo at 60 and falls back to 30", () => {
    expect(outputFps([probe({ fps: 240 })])).toBe(60);
    expect(outputFps([probe({ fps: 0 })])).toBe(30);
  });
  it("uses the highest rate across clips", () => {
    expect(outputFps([probe({ fps: 30 }), probe({ fps: 60 })])).toBe(60);
  });
});

describe("encoder settings", () => {
  it("encodes at CRF 18 with a 12M peak, 48 kHz 192k audio, faststart", () => {
    const args = videoEncodeArgs({ fps: 30, outputSeconds: 10 });
    const at = (k: string) => args[args.indexOf(k) + 1];
    expect(at("-crf")).toBe(String(VIDEO_CRF));
    expect(VIDEO_CRF).toBeLessThanOrEqual(19);
    expect(at("-maxrate")).toBe("12M");
    expect(at("-ar")).toBe(String(AUDIO_SAMPLE_RATE));
    expect(at("-b:a")).toBe("192k");
    expect(at("-preset")).toBe("slow");
    expect(at("-movflags")).toBe("+faststart");
    expect(at("-color_trc")).toBe("bt709");
  });
  it("uses level 4.2 for 60 fps and drops audio for silent renditions", () => {
    const args = videoEncodeArgs({ fps: 60, outputSeconds: 5, audio: false });
    expect(args[args.indexOf("-level:v") + 1]).toBe("4.2");
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });
  it("only drops below the slow preset for long uploads", () => {
    expect(x264Preset(60, 30)).toBe("slow");
    expect(x264Preset(120, 60)).toBe("medium");
    expect(x264Preset(600, 60)).toBe("faster");
  });
});

describe("HDR and passthrough rules", () => {
  it("detects iPhone HLG and PQ", () => {
    expect(isHdr({ colorTransfer: "arib-std-b67", colorPrimaries: "bt2020" })).toBe(true);
    expect(isHdr({ colorTransfer: "smpte2084", colorPrimaries: "bt2020" })).toBe(true);
    expect(isHdr({ colorTransfer: "bt709", colorPrimaries: "bt709" })).toBe(false);
  });
  it("keeps an SDR H.264/HEVC 1080p clip as uploaded", () => {
    expect(canPassthrough(probe())).toBe(true);
    expect(canPassthrough(probe({ codec: "hevc", fps: 60 }))).toBe(true);
    expect(canPassthrough(probe({ width: 1920, height: 1080 }))).toBe(true);
  });
  it("re-encodes HDR, 10-bit, 4K, VP9, absurd bitrates and non-AAC audio", () => {
    expect(canPassthrough(probe({ colorTransfer: "arib-std-b67", colorPrimaries: "bt2020", pixFmt: "yuv420p10le" }))).toBe(false);
    expect(canPassthrough(probe({ width: 2160, height: 3840 }))).toBe(false);
    expect(canPassthrough(probe({ codec: "vp9" }))).toBe(false);
    expect(canPassthrough(probe({ bitRate: 50_000_000 }))).toBe(false);
    expect(canPassthrough(probe({ audioCodec: "opus" }))).toBe(false);
  });
  it("tags HEVC as hvc1 on remux so Apple players accept it", () => {
    expect(passthroughRemuxArgs("in", "out", probe({ codec: "hevc" }))).toContain("hvc1");
    expect(passthroughRemuxArgs("in", "out", probe())).toContain("+faststart");
  });
  it("reads display size through iPhone rotation metadata", () => {
    const p = parseProbe({
      streams: [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, avg_frame_rate: "30/1", side_data_list: [{ rotation: -90 }] }],
      format: { duration: "3.0", bit_rate: "9000000" },
    });
    expect([p.width, p.height]).toEqual([1080, 1920]);
  });
});

// ── Real ffmpeg: output dimensions, fps and colour tags ──────────────────────
let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }

describe.skipIf(!ffmpeg)("ffmpeg renders (real encodes)", () => {
  let dir = "";
  const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
  const clip = (name: string, w: number, h: number, fps: number, extra: string[] = []) => {
    const out = join(dir, name);
    ff("-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=${fps}:duration=1`,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      ...extra, "-shortest", out);
    return out;
  };
  const compose = async (input: string) => {
    const p = await probeVideo(input);
    const canvas = videoCanvas([p]);
    const fps = outputFps([p]);
    const out = join(dir, `out-${Math.random().toString(36).slice(2)}.mp4`);
    ff("-i", input, "-filter_complex",
      `[0:v]${composeClipChain(canvas, fps, { hdr: isHdr(p), zscale: await hasZscale() })}[v]`,
      "-map", "[v]", "-map", "0:a", ...videoEncodeArgs({ fps, outputSeconds: 1 }), out);
    return probeVideo(out);
  };

  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "mq-test-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it("composes a 1080x1920 60 fps clip at 1080x1920 60 fps", async () => {
    const out = await compose(clip("a.mp4", 1080, 1920, 60, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]));
    expect([out.width, out.height]).toEqual([1080, 1920]);
    expect(out.fps).toBeCloseTo(60, 0);
    expect(out.colorTransfer).toBe("bt709");
  }, 60_000);

  it("downscales 4K HLG HDR to 1080x1920 SDR BT.709", async () => {
    const hdr = clip("hdr.mov", 2160, 3840, 30, [
      "-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error",
      "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-tag:v", "hvc1",
    ]);
    expect(isHdr(await probeVideo(hdr))).toBe(true);
    const out = await compose(hdr);
    expect([out.width, out.height]).toEqual([1080, 1920]);
    expect(out.pixFmt).toBe("yuv420p");
    expect(isHdr(out)).toBe(false);
  }, 120_000);

  it("never upscales a 720x1280 clip", async () => {
    const out = await compose(clip("b.mp4", 720, 1280, 30, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]));
    expect([out.width, out.height]).toEqual([720, 1280]);
  }, 60_000);

  it("passthrough remux keeps the original stream untouched", async () => {
    const input = clip("c.mp4", 1080, 1920, 30, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
    const p = await probeVideo(input);
    expect(canPassthrough(p)).toBe(true);
    const out = join(dir, "remux.mp4");
    execFileSync("ffmpeg", ["-v", "error", ...passthroughRemuxArgs(input, out, p)]);
    const hash = (f: string) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-map", "0:v", "-c", "copy", "-f", "md5", "-"]).toString();
    expect(hash(out)).toBe(hash(input));
  }, 60_000);

  it("renders cover/product renditions at 1080 on the short edge and avatars at 800x800", async () => {
    const input = clip("d.mp4", 2160, 3840, 30, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
    const cover = join(dir, "cover.mp4");
    await renderSilentRendition({ input, output: cover, poster: join(dir, "cover.jpg"), scale: longEdgeFilter(), posterOffset: 0.1 });
    const c = await probeVideo(cover);
    expect([c.width, c.height]).toEqual([1080, 1920]);
    expect(c.hasAudio).toBe(false);
    const avatar = join(dir, "avatar.mp4");
    await renderSilentRendition({
      input, output: avatar, poster: join(dir, "avatar.jpg"), posterOffset: 0.1,
      scale: "crop='min(iw,ih)':'min(iw,ih)',scale=800:800:flags=lanczos",
    });
    const a = await probeVideo(avatar);
    expect([a.width, a.height]).toEqual([800, 800]);
  }, 120_000);

  it("extracts the poster at full output resolution", async () => {
    const input = clip("e.mp4", 1080, 1920, 30, ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
    const poster = join(dir, "poster.jpg");
    ff(...posterArgs(input, poster, 0.2).slice(1));
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", poster]).toString().trim();
    expect(out).toBe("1080,1920");
  }, 60_000);
});

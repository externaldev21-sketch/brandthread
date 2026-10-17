import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { hasFaststart, inspectFeedVideo, meetsFeedVideoProfile, FEED_VIDEO_FFMPEG_ARGS } from "../feedVideoEncoding";

const probe = {
  streams: [{ codec_type: "video", codec_name: "h264", width: 720, height: 1280, pix_fmt: "yuv420p", bit_rate: "1500000" },
    { codec_type: "audio", codec_name: "aac" }],
  format: { tags: { major_brand: "isom" } },
};
describe("feed video playback profile", () => {
  it("accepts portrait, landscape and smaller sources without demanding 9:16", () => {
    expect(meetsFeedVideoProfile(probe, true)).toBe(true);
    expect(meetsFeedVideoProfile({ ...probe, streams: [{ ...probe.streams[0], width: 1280, height: 720 }] }, true)).toBe(true);
    expect(meetsFeedVideoProfile({ ...probe, streams: [{ ...probe.streams[0], width: 540, height: 540 }] }, true)).toBe(true);
  });
  it("rejects trailing moov, unsupported codecs, oversized and high bitrate media", () => {
    expect(meetsFeedVideoProfile(probe, false)).toBe(false);
    for (const change of [{ codec_name: "hevc" }, { pix_fmt: "yuv420p10le" }, { width: 1080, height: 1920 }, { bit_rate: "8000000" }]) {
      expect(meetsFeedVideoProfile({ ...probe, streams: [{ ...probe.streams[0], ...change }] }, true)).toBe(false);
    }
    expect(meetsFeedVideoProfile({ ...probe, format: { tags: { major_brand: "qt  " } } }, true)).toBe(false);
  });
  it("uses bounded mobile encoding, frequent keyframes and faststart without letterboxing", () => {
    expect(FEED_VIDEO_FFMPEG_ARGS).toContain("+faststart");
    expect(FEED_VIDEO_FFMPEG_ARGS).toContain("1800k");
    expect(FEED_VIDEO_FFMPEG_ARGS.join(" ")).not.toContain("pad=");
  });
  it("reads real MP4 box order, including extended-length boxes and invalid sizes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feed-box-test-"));
    const path = join(dir, "test.mp4");
    const box = (type: string) => { const b = Buffer.alloc(8); b.writeUInt32BE(8); b.write(type, 4); return b; };
    try {
      await writeFile(path, Buffer.concat([box("ftyp"), box("moov"), box("mdat")]));
      expect(await hasFaststart(path)).toBe(true);
      await writeFile(path, Buffer.concat([box("ftyp"), box("mdat"), box("moov")]));
      expect(await hasFaststart(path)).toBe(false);
      const extended = Buffer.alloc(16); extended.writeUInt32BE(1); extended.write("ftyp", 4); extended.writeBigUInt64BE(16n, 8);
      await writeFile(path, Buffer.concat([extended, box("moov"), box("mdat")]));
      expect(await hasFaststart(path)).toBe(true);
      await writeFile(path, Buffer.alloc(16));
      expect(await hasFaststart(path)).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("really converts a noncompliant 4:3 upload to H.264/faststart without changing its aspect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feed-encode-test-"));
    try {
      const input = join(dir, "input.mp4"), output = join(dir, "output.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10",
        "-t", "0.5", "-c:v", "mpeg4", "-threads", "1", input]);
      expect((await inspectFeedVideo(input)).compliant).toBe(false);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, ...FEED_VIDEO_FFMPEG_ARGS, output]);
      const result = await inspectFeedVideo(output);
      expect(result.compliant).toBe(true);
      const video = result.probe.streams.find(s => s.codec_type === "video")!;
      expect(video.width! / video.height!).toBeCloseTo(4 / 3);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});

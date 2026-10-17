import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFeedRenditions, renditionArgs, feedStreamMasterPath, legacyFeedStreamTarget } from "../feedVideoRenditions";

const exec = promisify(execFile);
describe("feed adaptive delivery", () => {
  it("bounds bitrate, uses two-second closed GOPs and retains progressive faststart", () => {
    expect(renditionArgs(720)).toContain("1800k");
    expect(renditionArgs(480)).toContain("800k");
    expect(renditionArgs(720)).not.toContain("-b:v");
    expect(renditionArgs(720, 400)).toContain("400k");
    expect(renditionArgs(480, 400)).toContain("400k");
    for (const h of [720, 480] as const) {
      expect(renditionArgs(h)).toContain("+faststart");
      expect(renditionArgs(h)).toContain("expr:gte(t,n_forced*2)");
      expect(renditionArgs(h).join(" ")).not.toContain("pad=");
    }
    expect(feedStreamMasterPath(`/objects/uploads/feed-stream/${"a".repeat(64)}/720.mp4`))
      .toBe(`/objects/uploads/feed-stream/${"a".repeat(64)}/master.m3u8`);
    expect(feedStreamMasterPath("/objects/uploads/raw.mp4")).toBeNull();
  });
  it("keeps old MP4 and HLS URLs mapped to the matching immutable rendition", () => {
    const old = `/objects/uploads/feed-stream/${"a".repeat(64)}`;
    const next = `/objects/uploads/feed-stream/${"b".repeat(64)}`;
    expect(legacyFeedStreamTarget("/objects/uploads/original.mp4", `${next}/720.mp4`)).toBe(`${next}/720.mp4`);
    expect(legacyFeedStreamTarget(`${old}/480/segment00002.ts`, `${next}/720.mp4`)).toBe(`${next}/480/segment00002.ts`);
    expect(legacyFeedStreamTarget(`${old}/master.m3u8`, `${next}/720.mp4`)).toBe(`${next}/master.m3u8`);
    expect(legacyFeedStreamTarget(`${old}/private.json`, `${next}/720.mp4`)).toBeNull();
    expect(legacyFeedStreamTarget(`${old}/master.m3u8`, "/objects/uploads/foreign.mp4")).toBeNull();
  });
  it("encodes real playable MP4s and complete two-rendition HLS without changing a photo-like video ratio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "feed-hls-test-"));
    try {
      const input = join(dir, "input.mp4");
      await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=30",
        "-t", "2.2", "-c:v", "mpeg4", "-threads", "1", input]);
      const outputs = await encodeFeedRenditions(input, dir);
      for (const h of [480, 720]) {
        const playlist = await readFile(join(dir, String(h), "index.m3u8"), "utf8");
        expect(playlist).toContain("#EXT-X-ENDLIST");
        expect(playlist).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
        expect(playlist).toContain("#EXTINF:2.000000,");
        await exec("ffmpeg", ["-v", "error", "-i", join(dir, String(h), "index.m3u8"), "-f", "null", "-"]);
        const { stdout } = await exec("ffprobe", ["-v", "error", "-show_streams", "-of", "json", join(dir, `${h}.mp4`)]);
        const stream = JSON.parse(stdout).streams[0];
        expect(stream.codec_name).toBe("h264");
        expect(stream.width / stream.height).toBeCloseTo(4 / 3);
      }
      expect(outputs.filter(o => o.relative.endsWith(".ts"))).toHaveLength(4);
      expect(await readFile(join(dir, "master.m3u8"), "utf8")).toContain("480/index.m3u8");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});

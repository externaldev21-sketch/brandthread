import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const exec = promisify(execFile);
export const FEED_STREAM_PROFILE = "feed-abr-720-480-hls2-source-cap-v4";
export function renditionArgs(shortEdge: 720 | 480, sourceKbps = Infinity): string[] {
  const high = shortEdge === 720;
  const longEdge = high ? 1280 : 854;
  const cap = Math.max(64, Math.round(Math.min(high ? 1800 : 800, sourceKbps)));
  return [
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
    "-vf", `scale=w='min(iw,if(gte(iw,ih),${longEdge},${shortEdge}))':h='min(ih,if(gte(iw,ih),${shortEdge},${longEdge}))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
    "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    // Capped VBR, not CBR: do not inflate already-small or static clips.
    "-crf", high ? "23" : "25", "-maxrate", `${cap}k`,
    "-bufsize", `${cap * 2}k`, "-r", "30", "-g", "60", "-keyint_min", "60",
    "-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*2)",
    "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4",
  ];
}

/** Preserve source masters and aspect ratio; publish only complete renditions.
 * Small bounded worker counts keep uploads from exhausting the API host. */
export async function encodeFeedRenditions(input: string, directory: string) {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,bit_rate",
    "-of", "json", input], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; bit_rate?: string }> };
  const sourceRate = Number(probe.streams?.find(s => s.codec_type === "video")?.bit_rate);
  const sourceKbps = Number.isFinite(sourceRate) && sourceRate > 0 ? sourceRate / 1000 : Infinity;
  const files: Array<{ local: string; relative: string; contentType: string }> = [];
  for (const height of [480, 720] as const) {
    const mp4 = join(directory, `${height}.mp4`);
    await exec("ffmpeg", ["-v", "error", "-y", "-i", input, ...renditionArgs(height, sourceKbps), mp4],
      { timeout: 600_000, maxBuffer: 1024 * 1024 });
    files.push({ local: mp4, relative: `${height}.mp4`, contentType: "video/mp4" });
    const hls = join(directory, String(height));
    await mkdir(hls);
    await exec("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-map", "0:v:0", "-map", "0:a:0?",
      "-c", "copy", "-hls_time", "2", "-hls_playlist_type", "vod",
      "-hls_flags", "independent_segments", "-hls_segment_filename", join(hls, "segment%05d.ts"),
      join(hls, "index.m3u8")], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    for (const name of await readdir(hls)) files.push({
      local: join(hls, name), relative: `${height}/${name}`,
      contentType: name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
    });
  }
  const master = join(directory, "master.m3u8");
  // Lowest rendition first: AVPlayer starts conservatively and adapts up.
  await writeFile(master, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=1000000,AVERAGE-BANDWIDTH=864000\n480/index.m3u8\n"
    + "#EXT-X-STREAM-INF:BANDWIDTH=2200000,AVERAGE-BANDWIDTH=1764000\n720/index.m3u8\n");
  files.push({ local: master, relative: "master.m3u8", contentType: "application/vnd.apple.mpegurl" });
  return files;
}

export function feedStreamMasterPath(path: string): string | null {
  return /^\/objects\/uploads\/feed-stream\/[a-f0-9]{64}\/720\.mp4$/.test(path)
    ? path.replace(/720\.mp4$/, "master.m3u8") : null;
}

/** Keep cached feed URLs usable after a rendition backfill. This only chooses
 * a target; the route must still verify the canonical published post. */
export function legacyFeedStreamTarget(path: string, rendition: unknown): string | null {
  if (typeof rendition !== "string" || !feedStreamMasterPath(rendition) || path === rendition) return null;
  const root = path.match(/^(\/objects\/uploads\/feed-stream\/[a-f0-9]{64})\//)?.[1];
  if (!root) return path.startsWith("/objects/uploads/") && path.endsWith(".mp4") ? rendition : null;
  const tail = path.slice(root.length);
  if (!/^\/(?:master\.m3u8|(?:480|720)\.mp4|(?:480|720)\/(?:index\.m3u8|segment\d{5}\.ts))$/.test(tail)) return null;
  return rendition.replace(/\/720\.mp4$/, tail);
}

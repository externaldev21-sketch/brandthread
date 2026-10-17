import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectStorageService } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { encodeFeedRenditions, FEED_STREAM_PROFILE } from "./feedVideoRenditions";

const exec = promisify(execFile);
const storage = new ObjectStorageService();
const PROFILE = FEED_STREAM_PROFILE;
export const FEED_VIDEO_FFMPEG_ARGS = [
  "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
  "-vf", "scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
  "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
  "-maxrate", "1800k", "-bufsize", "3600k", "-r", "30", "-g", "30",
  "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-f", "mp4",
] as const;

export type FeedVideoProbe = {
  streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; bit_rate?: string }>;
  format?: { bit_rate?: string; tags?: { major_brand?: string } };
};
export function meetsFeedVideoProfile(probe: FeedVideoProbe, faststart: boolean): boolean {
  const video = probe.streams.find(s => s.codec_type === "video");
  const audio = probe.streams.find(s => s.codec_type === "audio");
  if (!video?.width || !video.height) return false;
  return faststart && video.codec_name === "h264" && video.pix_fmt === "yuv420p" &&
    Math.max(video.width, video.height) <= 1280 && Math.min(video.width, video.height) <= 720 &&
    Number(video.bit_rate ?? probe.format?.bit_rate ?? Infinity) <= 2_400_000 &&
    !probe.format?.tags?.major_brand?.trim().startsWith("qt") &&
    (!audio || audio.codec_name === "aac");
}

/** Inspect top-level boxes without loading a potentially 1 GB upload into RAM. */
export async function hasFaststart(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(16);
    for (let offset = 0; offset + 8 <= size;) {
      const { bytesRead } = await file.read(header, 0, 16, offset);
      if (bytesRead < 8) return false;
      const type = header.toString("ascii", 4, 8);
      if (type === "moov") return true;
      if (type === "mdat") return false;
      const length = header.readUInt32BE(0);
      const boxSize = length === 1 && bytesRead >= 16 ? Number(header.readBigUInt64BE(8)) : length;
      if (!Number.isSafeInteger(boxSize) || boxSize < 8) return false;
      offset += boxSize;
    }
    return false;
  } finally { await file.close(); }
}

export async function inspectFeedVideo(path: string) {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as FeedVideoProbe;
  const faststart = await hasFaststart(path);
  return { probe, faststart, compliant: meetsFeedVideoProfile(probe, faststart) };
}

/** Normalize only owned uploads. Keep the original master; publish the rendition. */
export async function normalizeFeedVideoPath(path: string, owner: string): Promise<string> {
  if (!/^\/objects\/uploads\/[A-Za-z0-9._/-]+$/.test(path) || path.includes("..")) throw new Error("Invalid video object path");
  const file = await storage.getObjectEntityFile(path);
  if (!(await storage.canAccessObjectEntity({ objectFile: file, userId: owner, requestedPermission: ObjectPermission.WRITE }))) {
    throw new Error("Video is not owned by the publisher");
  }
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.feedVideoProfile === PROFILE) return path;
  const existing = metadata.metadata?.feedVideoRenditionPath;
  if (typeof existing === "string" && existing.startsWith("/objects/uploads/feed-stream/")) {
    const cached = await storage.getObjectEntityFile(existing);
    const [saved] = await cached.getMetadata();
    if (saved.metadata?.feedVideoProfile === PROFILE) return existing;
  }
  let inputFile = file;
  let inputPath = path;
  let inputMetadata = metadata;
  // Rebuild from the retained source master, not a previously encoded rendition.
  const sourcePath = metadata.metadata?.feedVideoSourcePath;
  if (typeof sourcePath === "string" && sourcePath.startsWith("/objects/uploads/") && !sourcePath.includes("..")) {
    const source = await storage.getObjectEntityFile(sourcePath);
    if (!await storage.canAccessObjectEntity({ userId: owner, objectFile: source, requestedPermission: ObjectPermission.WRITE })) {
      throw new Error("Video source must be owned by its publisher");
    }
    inputFile = source;
    inputPath = sourcePath;
    [inputMetadata] = await source.getMetadata();
  }
  const dir = await mkdtemp(join(tmpdir(), "feed-video-"));
  try {
    const input = join(dir, "input");
    await inputFile.download({ destination: input });
    const root = `/objects/uploads/feed-stream/${createHash("sha256").update(`${inputPath}:${inputMetadata.generation}:${owner}:${PROFILE}`).digest("hex")}`;
    const renditions = await encodeFeedRenditions(input, dir);
    if (!(await inspectFeedVideo(join(dir, "720.mp4"))).compliant) throw new Error("Encoded video failed playback-profile validation");
    // Bounded streaming uploads, never buffer the complete video in memory.
    for (let i = 0; i < renditions.length; i += 4) {
      await Promise.all(renditions.slice(i, i + 4).map(async rendition => {
        await storage.uploadObjectEntityFromFile(rendition.local, rendition.contentType, `${root}/${rendition.relative}`);
      }));
    }
    const destination = `${root}/720.mp4`;
    await storage.trySetObjectEntityAclPolicy(destination, { owner, visibility: "private" });
    const saved = await storage.getObjectEntityFile(destination);
    await saved.setMetadata({ metadata: { feedVideoProfile: PROFILE, feedVideoSourcePath: inputPath } });
    await file.setMetadata({ metadata: { ...metadata.metadata, feedVideoRenditionPath: destination } });
    if (inputPath !== path) await inputFile.setMetadata({ metadata: { ...inputMetadata.metadata, feedVideoRenditionPath: destination } });
    return destination;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** A real, contentful frame rather than a black opening fade. */
export async function createFeedVideoPoster(path: string, owner: string): Promise<string> {
  const file = await storage.getObjectEntityFile(path);
  if (!(await storage.canAccessObjectEntity({ objectFile: file, userId: owner, requestedPermission: ObjectPermission.WRITE }))) {
    throw new Error("Video is not owned by the publisher");
  }
  const dir = await mkdtemp(join(tmpdir(), "feed-poster-"));
  try {
    const input = join(dir, "input"), output = join(dir, "poster.jpg");
    await file.download({ destination: input });
    await exec("ffmpeg", ["-v", "error", "-y", "-i", input, "-t", "30",
      "-vf", "blackframe=amount=0:threshold=24,metadata=select:key=lavfi.blackframe.pblack:value=95:function=less,thumbnail=15,scale=720:-2",
      "-frames:v", "1", "-q:v", "2", output], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    const bytes = await readFile(output);
    const ownerKey = createHash("sha256").update(owner).digest("hex").slice(0, 16);
    const objectPath = `/objects/uploads/feed-video-posters/${ownerKey}/${createHash("sha256").update(bytes).digest("hex")}.jpg`;
    await storage.createObjectEntityFromBuffer(bytes, "image/jpeg", objectPath);
    await storage.trySetObjectEntityAclPolicy(objectPath, { owner, visibility: "private" });
    return objectPath;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

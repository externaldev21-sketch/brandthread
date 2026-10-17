#!/usr/bin/env -S tsx
/**
 * Read-only report: resolution, bitrate and size of every media file behind
 * the @brandthread official posts (the seed content), so we can tell whether
 * the import used the original 720x1280 videos / 736x981 photos or a
 * re-encoded copy (e.g. the crf-28 "small" zip). Changes nothing.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run audit:official-seed-media
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { OFFICIAL_ACCOUNT_CLERK_ID } from "../src/lib/officialSeed/config";
import { imageBufferDims, objectPathFor } from "../src/lib/mediaDimensions";
import { ObjectStorageService } from "../src/lib/objectStorage";

const exec = promisify(execFile);
const storage = new ObjectStorageService();

async function describe(urlOrPath: string): Promise<string> {
  const objectPath = objectPathFor(urlOrPath);
  if (!objectPath) return `${urlOrPath} (external — not in our storage)`;
  const file = await storage.getObjectEntityFile(objectPath);
  const [meta] = await file.getMetadata();
  const size = Number(meta.size ?? 0);
  const type = String(meta.contentType ?? "");
  if (type.startsWith("video/")) {
    const url = await storage.getObjectEntityDownloadURL(objectPath, 600);
    const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,avg_frame_rate,bit_rate:format=bit_rate,duration",
      "-of", "json", url], { timeout: 60_000, maxBuffer: 4 << 20 });
    const j = JSON.parse(String(stdout));
    const s = j.streams?.[0] ?? {};
    const kbps = Math.round(Number(s.bit_rate ?? j.format?.bit_rate ?? 0) / 1000);
    return `${objectPath}  video ${s.codec_name} ${s.width}x${s.height} ${s.avg_frame_rate}fps ${kbps} kb/s ${(size / 1048576).toFixed(2)} MB`;
  }
  const [bytes] = await file.download();
  const d = await imageBufferDims(bytes);
  return `${objectPath}  image ${type} ${d?.width}x${d?.height} ${(size / 1024).toFixed(0)} KB`;
}

async function main() {
  const rows = await db.select({
    id: posts.id, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl,
    mediaPaths: posts.mediaPaths, mediaUrls: posts.mediaUrls, slides: posts.slides, caption: posts.caption,
  }).from(posts).where(eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID));
  console.log(`${rows.length} official post(s)`);
  for (const p of rows) {
    console.log(`\n# ${p.id} (${p.mediaType}) ${String(p.caption ?? "").slice(0, 60)}`);
    const media = p.slides.length ? p.slides.map((s) => s.path) : (p.mediaPaths.length ? p.mediaPaths : (p.mediaUrls.length ? p.mediaUrls : [p.mediaUrl]));
    for (const m of [...media, ...(p.thumbnailUrl ? [p.thumbnailUrl] : [])]) {
      console.log("  " + await describe(m).catch((err) => `${m}  ERROR ${(err as Error).message}`));
    }
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });

/**
 * Pixel dimensions for post media, so every client can lay a feed/profile/
 * grid item out at its FINAL size on the first frame (no onLoad/onLayout
 * resize, no "big then regular size" snap).
 *
 * Compose routes (post-video, post-slide, post-carousel) know the exact output
 * size and stamp it on the stored object as custom metadata
 * (`bt-width`/`bt-height`). Post creation reads it back from object metadata
 * (cheap, server-trusted — never taken from the client); objects without it
 * (older uploads, seed imports) are probed: sharp for images, ffprobe over a
 * signed URL for videos. The backfill job uses the same probe.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

const exec = promisify(execFile);
const storage = new ObjectStorageService();

export interface MediaDims { width: number; height: number }

export const DIMS_META_WIDTH = "bt-width";
export const DIMS_META_HEIGHT = "bt-height";
/** Images larger than this are not downloaded just to be measured. */
const MAX_PROBE_IMAGE_BYTES = 60 * 1024 * 1024;

/** Custom object metadata recording a stored object's pixel size. */
export function dimsMetadata(d: MediaDims | null | undefined): Record<string, string> | undefined {
  if (!isValidDims(d)) return undefined;
  return { [DIMS_META_WIDTH]: String(Math.round(d.width)), [DIMS_META_HEIGHT]: String(Math.round(d.height)) };
}

export function isValidDims(d: unknown): d is MediaDims {
  const v = d as MediaDims | null | undefined;
  return !!v && Number.isInteger(v.width) && Number.isInteger(v.height) &&
    v.width > 0 && v.height > 0 && v.width <= 16384 && v.height <= 16384;
}

/** Pure: dims from GCS custom metadata, or null. */
export function dimsFromMetadata(meta: Record<string, unknown> | undefined | null): MediaDims | null {
  const custom = (meta?.metadata ?? {}) as Record<string, unknown>;
  const d = { width: Number(custom[DIMS_META_WIDTH]), height: Number(custom[DIMS_META_HEIGHT]) };
  return isValidDims(d) ? d : null;
}

/** Display size of an image buffer (EXIF orientation applied). */
export async function imageBufferDims(bytes: Buffer): Promise<MediaDims | null> {
  const m = await sharp(bytes, { failOn: "none" }).metadata();
  if (!m.width || !m.height) return null;
  const swap = (m.orientation ?? 1) >= 5;
  return { width: swap ? m.height : m.width, height: swap ? m.width : m.height };
}

/** Display size of a video at a path or URL (rotation applied). */
export async function videoDims(pathOrUrl: string): Promise<MediaDims | null> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", pathOrUrl,
  ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const s = (JSON.parse(String(stdout)).streams ?? [])[0];
  if (!s?.width || !s?.height) return null;
  const rot = Number((s.side_data_list ?? []).find((d: any) => d.rotation !== undefined)?.rotation ?? s.tags?.rotate ?? 0);
  const swap = Math.abs(rot % 180) === 90;
  const d = { width: swap ? Number(s.height) : Number(s.width), height: swap ? Number(s.width) : Number(s.height) };
  return isValidDims(d) ? d : null;
}

/** `/objects/...` path for one of our media URLs/paths, else null (external URL). */
export function objectPathFor(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath) return null;
  if (urlOrPath.startsWith("/objects/")) return urlOrPath.split("?")[0];
  const m = /\/api\/(?:posts\/media|profile\/(?:avatar|cover)-media|product-videos\/media)\/([A-Za-z0-9._/-]+)(?:\?.*)?$/.exec(urlOrPath);
  if (!m || m[1].split("/").includes("..")) return null;
  return `/objects/${m[1]}`;
}

function looksLikeVideo(contentType: string, urlOrPath: string): boolean {
  return contentType.startsWith("video/") || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(urlOrPath);
}

/**
 * Pixel size of one stored post media object (or an external http(s) URL).
 * Fails soft: returns null when it can't be measured.
 */
export async function measureMedia(urlOrPath: string | null | undefined): Promise<MediaDims | null> {
  if (!urlOrPath) return null;
  try {
    const objectPath = objectPathFor(urlOrPath);
    if (objectPath) {
      const file = await storage.getObjectEntityFile(objectPath);
      const [meta] = await file.getMetadata();
      const stamped = dimsFromMetadata(meta as Record<string, unknown>);
      if (stamped) return stamped;
      const contentType = String(meta.contentType ?? "");
      if (looksLikeVideo(contentType, objectPath)) {
        return await videoDims(await storage.getObjectEntityDownloadURL(objectPath, 10 * 60));
      }
      if (Number(meta.size ?? 0) > MAX_PROBE_IMAGE_BYTES) return null;
      const [bytes] = await file.download();
      return await imageBufferDims(bytes);
    }
    if (!/^https?:\/\//i.test(urlOrPath)) return null;
    if (looksLikeVideo("", urlOrPath)) return await videoDims(urlOrPath);
    const res = await fetch(urlOrPath, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    if (looksLikeVideo(String(res.headers.get("content-type") ?? ""), urlOrPath)) {
      await res.body?.cancel();
      return await videoDims(urlOrPath);
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_PROBE_IMAGE_BYTES) { await res.body?.cancel(); return null; }
    return await imageBufferDims(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    logger.warn({ err, media: String(urlOrPath).slice(0, 200) }, "media dimensions: could not measure");
    return null;
  }
}

/** The dimension columns for a post, measured from its stored media. */
export interface PostMediaDims {
  mediaWidth: number;
  mediaHeight: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  mediaDimensions: Array<MediaDims | null>;
  slides?: Array<Record<string, unknown>>;
}

type SlideLike = { kind?: string; path?: string; url?: string; thumbnailPath?: string; thumbnailUrl?: string } & Record<string, unknown>;

/**
 * Measure everything a post shows. `0` marks "measured, unknown" so the
 * backfill never retries a broken post forever.
 */
export async function measurePostMedia(post: {
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  mediaUrls?: string[] | null;
  mediaPaths?: string[] | null;
  slides?: SlideLike[] | null;
  mediaType?: string | null;
}): Promise<PostMediaDims> {
  const urls = (post.mediaPaths?.length ? post.mediaPaths : post.mediaUrls) ?? [];
  const slides = post.slides ?? [];
  const [mediaDimensions, slideDims, primaryDims, thumbDims] = await Promise.all([
    Promise.all(urls.map((u) => measureMedia(u))),
    Promise.all(slides.map(async (s) => ({
      media: await measureMedia(s.path ?? s.url),
      thumb: s.kind === "video" ? await measureMedia(s.thumbnailPath ?? s.thumbnailUrl) : null,
    }))),
    urls.length === 0 && slides.length === 0 ? measureMedia(post.mediaUrl) : Promise.resolve(null),
    measureMedia(post.thumbnailUrl),
  ]);
  const primary = slideDims[0]?.media ?? mediaDimensions[0] ?? primaryDims;
  const thumb = thumbDims ?? (slideDims[0] ? (slideDims[0].thumb ?? slideDims[0].media) : null) ?? primary;
  return {
    mediaWidth: primary?.width ?? 0,
    mediaHeight: primary?.height ?? 0,
    thumbnailWidth: thumb?.width ?? 0,
    thumbnailHeight: thumb?.height ?? 0,
    mediaDimensions,
    ...(slides.length > 0
      ? {
        slides: slides.map((s, i) => {
          const m = slideDims[i].media;
          const t = slideDims[i].thumb ?? m;
          return {
            ...s,
            ...(m ? { width: m.width, height: m.height } : {}),
            ...(t ? { thumbnailWidth: t.width, thumbnailHeight: t.height } : {}),
          };
        }),
      }
      : {}),
  };
}

/**
 * The dimension fields every post payload carries. Spread into each API
 * serializer so feeds, profile grids, Discover, search and single-post views
 * all agree. Unknown (null/0) comes back as null.
 */
export function postDimsPayload(row: {
  mediaWidth?: number | null; mediaHeight?: number | null;
  thumbnailWidth?: number | null; thumbnailHeight?: number | null;
  mediaDimensions?: Array<MediaDims | null> | null;
}): {
  mediaWidth: number | null; mediaHeight: number | null;
  thumbnailWidth: number | null; thumbnailHeight: number | null;
  mediaDimensions: Array<MediaDims | null>;
} {
  const pos = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);
  return {
    mediaWidth: pos(row.mediaWidth),
    mediaHeight: pos(row.mediaHeight),
    thumbnailWidth: pos(row.thumbnailWidth),
    thumbnailHeight: pos(row.thumbnailHeight),
    mediaDimensions: Array.isArray(row.mediaDimensions) ? row.mediaDimensions : [],
  };
}

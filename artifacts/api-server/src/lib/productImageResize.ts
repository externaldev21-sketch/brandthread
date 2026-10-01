/**
 * Chat product card image resizing (item 70 follow-up — Dev's live Orison
 * thread check: the card's photo was requesting the full original upload
 * (e.g. 1080x1920) for a ~240pt-wide card slot, showing a blur placeholder
 * for ~10s on a real connection before it painted).
 *
 * expo-image (via CachedImage) decodes remote images at their RENDERED
 * size, which keeps memory bounded — but that's a decode-time optimization
 * only. The full original bytes are still downloaded over the network
 * before any of that happens, so a multi-MB original is exactly as slow to
 * *load* at a 240pt card as it is anywhere else. There was no existing
 * resize/CDN-transform convention anywhere in this codebase (every other
 * thumbnail — ProductCard, feed, etc. — has the same latent gap, just less
 * visible at their smaller render sizes) — see this PR's description for
 * what was checked before adding one here.
 *
 * This generates and caches a width-capped copy of a product's cover image
 * in the same object storage used for the original, the first time a chat
 * card asks for one, and reuses it after that. It never re-derives the
 * URL-resolution path the original image already uses (whatever that is in
 * a given deployment) — the resized copy is written at a same-shaped
 * `/objects/...` path with the same ACL policy as the original, so
 * anything that could already fetch the original can fetch this the same
 * way.
 */
import sharp from "sharp";
import { logger } from "./logger";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";

const objectStorage = new ObjectStorageService();

/** ~3x a 240pt-wide chat card at retina density, comfortably crisp without
 *  being a multi-megabyte original. */
export const CHAT_CARD_IMAGE_WIDTH = 720;

/** Long edge (px) every uploaded image is capped at on the server. */
export const MAX_STORED_IMAGE_EDGE = 2048;
/** JPEG/WebP quality for re-encoded uploads. */
export const UPLOAD_IMAGE_QUALITY = 80;
/** Variant widths that may be generated; anything else snaps to the nearest one. */
export const IMAGE_VARIANT_WIDTHS = [240, 480, 720, 1080, 1600] as const;
/**
 * Variant objects are written once under a width-suffixed copy of a
 * random-UUID original path and never rewritten, so they are safe to cache
 * forever on clients and CDNs.
 */
export const IMMUTABLE_VARIANT_CACHE_CONTROL = "private, max-age=31536000, immutable";
export const IMMUTABLE_PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Nearest allowed variant width (ties go to the larger, so images stay crisp). */
export function snapVariantWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return IMAGE_VARIANT_WIDTHS[0];
  let best: number = IMAGE_VARIANT_WIDTHS[0];
  for (const candidate of IMAGE_VARIANT_WIDTHS) {
    if (Math.abs(candidate - width) <= Math.abs(best - width)) best = candidate;
  }
  return best;
}

/** Target pixel size for a long-edge cap. Never upscales; keeps aspect ratio. */
export function fitLongEdge(
  width: number,
  height: number,
  maxEdge: number = MAX_STORED_IMAGE_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width, height };
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function resizedObjectPath(originalPath: string, width: number): string | null {
  // Only our own object-storage-backed paths can be resized this way — an
  // external URL (e.g. a Shopify-imported CDN image) is out of our storage
  // and typically already appropriately sized, so it's returned unchanged.
  if (!originalPath.startsWith("/objects/")) return null;
  return `${originalPath}-w${width}`;
}

function sharpFormatFor(contentType: string): "jpeg" | "png" | "webp" {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpeg";
}

/**
 * Decode, apply EXIF orientation, cap the long edge and re-encode. sharp
 * writes no metadata unless asked, so EXIF/GPS/ICC text is dropped. PNG and
 * WebP keep their format (cut-out transparency survives); everything else is
 * JPEG. Never enlarges.
 */
export async function resizeImageBuffer(
  input: Buffer,
  contentType: string,
  { maxEdge = MAX_STORED_IMAGE_EDGE, width, quality = UPLOAD_IMAGE_QUALITY }: {
    maxEdge?: number;
    width?: number;
    quality?: number;
  } = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  const format = sharpFormatFor(contentType);
  const pipeline = sharp(input).rotate();
  const resized = width
    ? pipeline.resize({ width, withoutEnlargement: true })
    : pipeline.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  const buffer = await resized
    .toFormat(format, format === "png" ? undefined : { quality })
    .toBuffer();
  return { buffer, contentType: `image/${format}` };
}

/**
 * Upload-time normalisation for raster images: cap at MAX_STORED_IMAGE_EDGE,
 * re-encode, strip metadata. Fails open (returns the original bytes) on
 * anything sharp cannot decode. A file that is already within the cap, has
 * no EXIF block and would not shrink is stored untouched. GIFs pass through
 * so animations survive.
 */
export async function normalizeUploadedImage(
  bytes: Buffer,
  contentType: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (contentType === "image/gif" || !contentType.startsWith("image/")) return { buffer: bytes, contentType };
  try {
    const metadata = await sharp(bytes).metadata();
    const overCap = Math.max(metadata.width ?? 0, metadata.height ?? 0) > MAX_STORED_IMAGE_EDGE;
    const result = await resizeImageBuffer(bytes, contentType);
    if (!overCap && !metadata.exif && result.buffer.length >= bytes.length) {
      return { buffer: bytes, contentType };
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "upload image normalisation failed, storing original");
    return { buffer: bytes, contentType };
  }
}

/**
 * Returns a `/objects/...` path serving a width-capped copy of a product
 * image, generating and caching it in object storage on first request.
 * Fails open on any error (download, resize, storage) — a chat card must
 * never break over this, so the original path is returned instead.
 */
export async function getChatCardImagePath(
  originalPath: string,
  width: number = CHAT_CARD_IMAGE_WIDTH,
): Promise<string> {
  return getImageVariantPath(originalPath, width);
}

/** Generalised form of the chat card resize: any original `/objects/...` image at `width` (use snapVariantWidth to pick a standard width). */
export async function getImageVariantPath(
  originalPath: string,
  width: number,
): Promise<string> {
  const derivedPath = resizedObjectPath(originalPath, width);
  if (!derivedPath) return originalPath;

  // Cache hit — already resized by an earlier request.
  try {
    await objectStorage.getObjectEntityFile(derivedPath);
    return derivedPath;
  } catch (err) {
    if (!(err instanceof ObjectNotFoundError)) {
      logger.warn({ err, originalPath }, "chat card image resize: cache lookup failed, serving original");
      return originalPath;
    }
  }

  try {
    const originalFile = await objectStorage.getObjectEntityFile(originalPath);
    const [metadata] = await originalFile.getMetadata();
    const contentType = (metadata.contentType as string) || "image/jpeg";
    const format = sharpFormatFor(contentType);
    const [buffer] = await originalFile.download();

    const resizedBuffer = await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .toFormat(format, format === "png" ? undefined : { quality: 82 })
      .toBuffer();

    await objectStorage.createObjectEntityFromBuffer(resizedBuffer, contentType, derivedPath, {
      cacheControl: IMMUTABLE_VARIANT_CACHE_CONTROL,
    });

    // Mirror the original's ACL policy onto the resized copy so it's
    // governed by the same access rules as the image it was derived from.
    const aclPolicy = await getObjectAclPolicy(originalFile);
    if (aclPolicy) {
      const resizedFile = await objectStorage.getObjectEntityFile(derivedPath);
      await setObjectAclPolicy(resizedFile, aclPolicy);
    }

    return derivedPath;
  } catch (err) {
    logger.warn({ err, originalPath }, "chat card image resize: failed, serving original");
    return originalPath;
  }
}

/** Resolves chat-card image paths for a batch of product images in
 *  parallel, failing open per item. */
export async function getChatCardImagePaths(
  originalPaths: (string | null)[],
  width: number = CHAT_CARD_IMAGE_WIDTH,
): Promise<(string | null)[]> {
  return Promise.all(
    originalPaths.map((p) => (p ? getChatCardImagePath(p, width) : Promise.resolve(p))),
  );
}

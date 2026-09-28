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
 * Returns a `/objects/...` path serving a width-capped copy of a product
 * image, generating and caching it in object storage on first request.
 * Fails open on any error (download, resize, storage) — a chat card must
 * never break over this, so the original path is returned instead.
 */
export async function getChatCardImagePath(
  originalPath: string,
  width: number = CHAT_CARD_IMAGE_WIDTH,
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
      .resize({ width, withoutEnlargement: true })
      .toFormat(format, format === "png" ? undefined : { quality: 82 })
      .toBuffer();

    await objectStorage.createObjectEntityFromBuffer(resizedBuffer, contentType, derivedPath);

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

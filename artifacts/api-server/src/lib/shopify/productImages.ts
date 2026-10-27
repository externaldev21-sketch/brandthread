/**
 * Copies a Shopify product's photos into Brandthread's object storage so the
 * listing never depends on the seller's Shopify store staying online.
 *
 * Only Shopify's own CDN is fetched (no seller-controlled hosts → no SSRF).
 * A photo already copied on an earlier run is reused via the link's
 * `imageMap`, so re-imports never re-download. Fails open per photo: if a
 * download or the storage write fails, the Shopify CDN URL is kept (the app
 * already renders absolute https product images) and counted as `linked`.
 */
import { ObjectStorageService } from "../objectStorage";
import { normalizeUploadedImage } from "../productImageResize";
import { logger } from "../logger";

const ALLOWED_HOSTS = new Set(["cdn.shopify.com"]);
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type ImageStore = {
  store(bytes: Buffer, contentType: string, ownerId: string): Promise<string>;
};

export const objectStorageImageStore: ImageStore = {
  async store(bytes, contentType, ownerId) {
    const storage = new ObjectStorageService();
    const normalized = await normalizeUploadedImage(bytes, contentType);
    const objectPath = await storage.createObjectEntityFromBuffer(normalized.buffer, normalized.contentType);
    await storage.trySetObjectEntityAclPolicy(objectPath, { owner: ownerId, visibility: "private" });
    return objectPath;
  },
};

/** The stable identity of a Shopify CDN image (its query string is a cache-buster). */
export function imageKey(url: string): string {
  return url.split("?")[0];
}

export function isShopifyCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { Accept: "image/jpeg,image/png,image/webp" },
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`image download failed: ${res.status}`);
  const contentType = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIMES.has(contentType)) throw new Error(`unsupported image type: ${contentType || "unknown"}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("image size out of range");
  return { bytes, contentType };
}

export async function mirrorShopifyImages(params: {
  ownerId: string;
  urls: string[];
  existingMap?: Record<string, string>;
  store?: ImageStore;
}): Promise<{ images: string[]; imageMap: Record<string, string>; stored: number; linked: number }> {
  const store = params.store ?? objectStorageImageStore;
  const imageMap: Record<string, string> = {};
  const images: string[] = [];
  let stored = 0;
  let linked = 0;
  for (const url of params.urls) {
    const key = imageKey(url);
    const known = params.existingMap?.[key];
    if (known) {
      imageMap[key] = known;
      images.push(known);
      continue;
    }
    if (!isShopifyCdnUrl(url)) {
      images.push(url);
      linked += 1;
      continue;
    }
    try {
      const { bytes, contentType } = await download(url);
      const objectPath = await store.store(bytes, contentType, params.ownerId);
      imageMap[key] = objectPath;
      images.push(objectPath);
      stored += 1;
    } catch (err) {
      logger.warn({ err, ownerId: params.ownerId }, "Shopify image copy failed; keeping the Shopify CDN link");
      images.push(url);
      linked += 1;
    }
  }
  return { images, imageMap, stored, linked };
}

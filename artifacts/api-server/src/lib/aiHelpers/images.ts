/**
 * Loads the caller's own uploaded images for vision prompts.
 *
 * Only Brandthread object paths (/objects/uploads/...) are accepted. No URL is
 * ever fetched, so there is no server-side request forgery surface, and each
 * path must belong to the caller: the object's ACL owner is the caller (or the
 * store they act for), or the path is already attached to one of their
 * products or posts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, posts, products } from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../objectStorage";
import { getObjectAclPolicy } from "../objectAcl";

export const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._-]{1,120}(?:\/[A-Za-z0-9._-]{1,120}){0,3}$/;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ImageAccessError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 413 = 403) {
    super(message);
  }
}

export function isValidObjectPath(value: unknown): value is string {
  return typeof value === "string" && OBJECT_PATH_RE.test(value) && !value.split("/").includes("..");
}

async function attachedToCaller(path: string, ownerId: string): Promise<boolean> {
  const [p] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.ownerId, ownerId), sql`${products.images}::jsonb ? ${path}`)).limit(1);
  if (p) return true;
  const [post] = await db.select({ id: posts.id }).from(posts)
    .where(and(eq(posts.userId, ownerId), sql`(${posts.mediaPaths} ? ${path} OR ${posts.mediaUrl} = ${path} OR ${posts.thumbnailUrl} = ${path})`)).limit(1);
  return Boolean(post);
}

/**
 * @param callerIds the store owner id and the acting member id (they may differ for team members)
 */
export async function loadOwnedImageDataUrl(path: string, callerIds: string[], opts: { trusted?: boolean } = {}): Promise<string> {
  if (!isValidObjectPath(path)) throw new ImageAccessError("Image must be one of your uploaded images", 400);
  const storage = new ObjectStorageService();
  let file;
  try {
    file = await storage.getObjectEntityFile(path);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new ImageAccessError("Image not found", 404);
    throw err;
  }
  if (!opts.trusted) {
    const acl = await getObjectAclPolicy(file);
    const owns = Boolean(acl && callerIds.includes(acl.owner));
    if (!owns) {
      let attached = false;
      for (const id of new Set(callerIds)) {
        if (await attachedToCaller(path, id)) { attached = true; break; }
      }
      if (!attached) throw new ImageAccessError("Image not found", 404);
    }
  }
  const [meta] = await file.getMetadata();
  const type = String(meta.contentType ?? "").toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new ImageAccessError("Only JPEG, PNG or WEBP images can be used", 400);
  if (Number(meta.size ?? 0) > MAX_IMAGE_BYTES) throw new ImageAccessError("Image is too large (6 MB max)", 413);
  const [buffer] = await file.download();
  if (buffer.length > MAX_IMAGE_BYTES) throw new ImageAccessError("Image is too large (6 MB max)", 413);
  return `data:${type};base64,${buffer.toString("base64")}`;
}

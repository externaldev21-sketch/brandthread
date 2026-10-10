/**
 * GET /api/v1/public/media/products/:productId/:index  (BT-314)
 *
 * Stable public address for a product photo, used by share previews, the
 * link-in-bio page, marketing emails and the sitemap. Redirects to a signed
 * object URL (or the stored https URL) — only for an image actually listed
 * on an ACTIVE, non-deleted product, so nothing private is reachable.
 */
import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, products } from "@workspace/db";
import { rateLimit } from "../middlewares/rateLimit";
import { ObjectStorageService } from "../lib/objectStorage";
import { isHttpsUrl, isObjectPath, MAX_PUBLIC_PRODUCT_IMAGES } from "../lib/publicMedia";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Signed URLs live 15 minutes; caches may keep the redirect for 10. */
const SIGNED_TTL_SECONDS = 900;
const REDIRECT_MAX_AGE_SECONDS = 600;

let storage: Pick<ObjectStorageService, "getObjectEntityDownloadURL"> | null = null;
export function setPublicMediaStorageForTests(s: typeof storage): void { storage = s; }
function objectStorage() { return (storage ??= new ObjectStorageService()); }

router.get("/media/products/:productId/:index", rateLimit("public-read"), async (req, res) => {
  const productId = String(req.params.productId);
  const index = Number(req.params.index);
  if (!UUID_RE.test(productId) || !Number.isInteger(index) || index < 0 || index >= MAX_PUBLIC_PRODUCT_IMAGES) {
    res.status(404).end();
    return;
  }
  try {
    const [row] = await db.select({ images: products.images }).from(products)
      .where(and(eq(products.id, productId), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);
    const raw = Array.isArray(row?.images) ? row.images[index] : undefined;
    let target: string | null = null;
    if (isHttpsUrl(raw)) target = raw.trim();
    else if (isObjectPath(raw)) target = await objectStorage().getObjectEntityDownloadURL(raw, SIGNED_TTL_SECONDS).catch(() => null);
    if (!target) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", `public, max-age=${REDIRECT_MAX_AGE_SECONDS}`);
    res.redirect(302, target);
  } catch (err) {
    req.log?.error({ err, productId }, "public product media failed");
    res.status(500).end();
  }
});

export default router;

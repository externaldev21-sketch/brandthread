/**
 * Waitlist — out-of-stock variant interest tracking.
 *
 * Buyer routes (all require auth):
 *   POST   /api/waitlist/join              — join waitlist for a variant
 *   DELETE /api/waitlist/leave             — leave waitlist for a variant
 *   GET    /api/waitlist/check/:variantId  — is current buyer on waitlist for variant?
 *
 * Seller routes (all require auth):
 *   GET    /api/waitlist/seller            — demand per variant/product
 *   POST   /api/waitlist/seller/notify/:variantId — feed + push to waitlisted buyers (once each)
 */
import { Router } from "express";
import { db, waitlistEntries, products, productVariants } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { productThumbnail } from "../lib/activityEvents";
import { cappedUnknown, looseBody, validateBody } from "../middlewares/bodySchemas";
import { notifyWaitlistRestock } from "../lib/stockNotifications";

const router = Router();

// Shape + size guards; the handlers require productId themselves.
const waitlistBody = looseBody({ productId: cappedUnknown(200), variantId: cappedUnknown(200) });
router.use(requireAuth);

// ── POST /api/waitlist/join ───────────────────────────────────────────────────

router.post("/join", validateBody(waitlistBody), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { productId, variantId } = req.body as { productId?: string; variantId?: string };

  if (!productId) { res.status(400).json({ error: "productId required" }); return; }

  // Resolve product to get sellerId
  const [product] = await db
    .select({ ownerId: products.ownerId, name: products.name })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  // Resolve variant label if variantId provided
  let variantLabel = "";
  if (variantId) {
    const [v] = await db
      .select({ size: productVariants.size, color: productVariants.color })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);
    if (v) variantLabel = [v.size, v.color].filter(Boolean).join(" / ");
  }

  // Upsert — ignore conflict
  await db
    .insert(waitlistEntries)
    .values({
      productId,
      variantId: variantId ?? null,
      userId,
      sellerId: product.ownerId,
      productName: product.name,
      variantLabel,
    })
    .onConflictDoNothing();

  res.json({ joined: true });
});

// ── DELETE /api/waitlist/leave ────────────────────────────────────────────────

router.delete("/leave", validateBody(waitlistBody), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  // Accept both query params (from mobile DELETE) and body (from web)
  const productId = (req.query.productId ?? req.body?.productId) as string | undefined;
  const variantId = (req.query.variantId ?? req.body?.variantId) as string | undefined;

  if (!productId) { res.status(400).json({ error: "productId required" }); return; }

  if (variantId) {
    await db.delete(waitlistEntries).where(
      and(
        eq(waitlistEntries.userId, userId),
        eq(waitlistEntries.productId, productId),
        eq(waitlistEntries.variantId, variantId),
      ),
    );
  } else {
    await db.delete(waitlistEntries).where(
      and(eq(waitlistEntries.userId, userId), eq(waitlistEntries.productId, productId)),
    );
  }

  res.json({ left: true });
});

// ── GET /api/waitlist/check/:variantId ────────────────────────────────────────

router.get("/check/:variantId", async (req, res) => {
  const userId   = (req as any).clerkUserId as string;
  const { variantId } = req.params;

  const [entry] = await db
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.userId, userId),
        eq(waitlistEntries.variantId, variantId),
      ),
    )
    .limit(1);

  res.json({ joined: !!entry });
});

// ── GET /api/waitlist/seller — demand per variant ─────────────────────────────

router.get("/seller", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  // Aggregate waitlist count per product + variant
  const rows = await db
    .select({
      productId:     waitlistEntries.productId,
      variantId:     waitlistEntries.variantId,
      productName:   waitlistEntries.productName,
      variantLabel:  waitlistEntries.variantLabel,
      count:         sql<number>`count(*)::int`,
      notifiedCount: sql<number>`count(*) filter (where ${waitlistEntries.notifiedAt} is not null)::int`,
    })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.sellerId, sellerId))
    .groupBy(
      waitlistEntries.productId,
      waitlistEntries.variantId,
      waitlistEntries.productName,
      waitlistEntries.variantLabel,
    )
    .orderBy(sql`count(*) desc`);

  res.json(rows);
});

// ── POST /api/waitlist/seller/notify/:variantId ───────────────────────────────

router.post("/seller/notify/:variantId", async (req, res) => {
  const sellerId  = (req as any).clerkUserId as string;
  const { variantId } = req.params;

  // Verify the variant belongs to this seller
  const [v] = await db
    .select({ productId: productVariants.productId, stock: productVariants.stock, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(products.ownerId, sellerId),
      ),
    )
    .limit(1);
  if (!v) { res.status(404).json({ error: "Variant not found or not yours" }); return; }

  // "Back in stock" for a size that is still at zero would be wrong, and the
  // shared restock path only claims entries for variants that have stock.
  if ((v.stock ?? 0) <= 0) {
    res.status(409).json({ error: "This size is out of stock. Restock it before notifying.", notified: 0 });
    return;
  }

  // Same path as an automatic restock: an atomic claim (notified_at IS NULL
  // ... RETURNING), so a buyer is never notified twice, then feed + push.
  const notifiedUserIds = await notifyWaitlistRestock({
    productId: v.productId,
    ownerId: sellerId,
    productName: v.productName,
    variantId,
  });

  if (notifiedUserIds.length === 0) {
    res.json({ notified: 0, message: "No un-notified buyers on this waitlist" });
    return;
  }
  res.json({ notified: notifiedUserIds.length });
});

export default router;

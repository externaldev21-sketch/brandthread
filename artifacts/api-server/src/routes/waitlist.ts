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
 *   POST   /api/waitlist/seller/notify/:variantId — push-notify all waitlisted buyers
 */
import { Router } from "express";
import { db, waitlistEntries, products, productVariants, notificationsFeed, pushTokens } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { productThumbnail } from "../lib/activityEvents";

const router = Router();
router.use(requireAuth);

// ── POST /api/waitlist/join ───────────────────────────────────────────────────

router.post("/join", async (req, res) => {
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

router.delete("/leave", async (req, res) => {
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
    .select({ productId: productVariants.productId, images: products.images })
    .from(productVariants)
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(products.ownerId, sellerId),
      ),
    )
    .limit(1);
  if (!v) { res.status(404).json({ error: "Variant not found or not yours" }); return; }

  // Fetch all un-notified waitlist entries for this variant
  const entries = await db
    .select({
      userId: waitlistEntries.userId,
      productName: waitlistEntries.productName,
      variantLabel: waitlistEntries.variantLabel,
    })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.variantId, variantId),
        eq(waitlistEntries.sellerId, sellerId),
        sql`${waitlistEntries.notifiedAt} is null`,
      ),
    );

  if (entries.length === 0) {
    res.json({ notified: 0, message: "No un-notified buyers on this waitlist" });
    return;
  }

  // Insert in-app notifications for each buyer
  const notifications = entries.map((e) => ({
    userId:   e.userId,
    category: "order",
    type:     "waitlist_restock",
    title:    "Back in stock!",
    body:     `${e.productName}${e.variantLabel ? ` (${e.variantLabel})` : ""} is available again. Grab it before it sells out.`,
    // Lets the Activity Center open the product and show its photo.
    targetId:       v.productId,
    targetType:     "product",
    targetImageUrl: productThumbnail(v.images),
  }));

  await db.insert(notificationsFeed).values(notifications);

  // Mark all as notified
  await db
    .update(waitlistEntries)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(waitlistEntries.variantId, variantId),
        eq(waitlistEntries.sellerId, sellerId),
      ),
    );

  res.json({ notified: entries.length });
});

export default router;

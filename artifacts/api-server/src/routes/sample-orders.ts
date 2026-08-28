/**
 * Sample & Bulk Order management — 6-stage production tracker with Stripe payments.
 * Mounted at /api/sample-orders
 *
 * POST /              seller creates a sample order (initiates Stripe PaymentIntent)
 * GET  /              list seller's orders
 * GET  /:id           get order detail
 * POST /:id/pay       confirm Stripe payment and activate order
 * PATCH/:id/advance   manufacturer advances production stage
 * PATCH/:id/tracking  add tracking number (triggers payout release to manufacturer)
 * POST /:id/pay-from-wallet  seller pays bulk order from drop wallet
 *
 * Sample image flow (no Stripe):
 * POST /:id/images/request-upload  → { uploadURL, objectPath } presigned GCS PUT
 * POST /:id/images                 → record objectPath + set ACL owner; returns display URLs
 * GET  /:id/images                 → list images as short-lived signed GET URLs
 */
import express, { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sampleOrders, manufacturers, manufacturerThreads, dropWallets, dropWalletTransactions } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, PLATFORM_COMMISSION_RATE, computeApplicationFeeCents } from "../lib/stripe";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router = Router();
router.use(requireAuth);

const objectStorage = new ObjectStorageService();

// Accepted image MIME types + max size for sample progress photos.
const ACCEPTED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp",
  "image/heic", "image/heif",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

function isValidImageBytes(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  }
  if (contentType === "image/heic" || contentType === "image/heif") {
    return bytes.length >= 12 && bytes.subarray(4, 8).toString() === "ftyp";
  }
  return false;
}

/**
 * Loads a sample order and authorizes the caller against the existing
 * seller/manufacturer model (mirrors the /advance route). Returns the order
 * row (with mfrClerkId) or null if not found / unauthorized.
 */
async function loadAuthorizedOrder(orderId: string, clerkUserId: string) {
  const [row] = await db
    .select({ order: sampleOrders, mfrClerkId: manufacturers.clerkId })
    .from(sampleOrders)
    .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(eq(sampleOrders.id, orderId))
    .limit(1);

  if (!row) return { status: 404 as const, order: null };

  const isSeller       = row.order.sellerId === clerkUserId;
  const isManufacturer = row.mfrClerkId === clerkUserId;
  if (!isSeller && !isManufacturer) return { status: 403 as const, order: null };

  return { status: 200 as const, order: row.order };
}

const ORDER_STAGES = [
  "payment_received",
  "processing",
  "cut_and_sew",
  "packing",
  "shipped",
  "delivered",
] as const;

// ── GET /api/sample-orders ────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const rows = await db
      .select({
        order:        sampleOrders,
        mfrName:      manufacturers.businessName,
        mfrCountry:   manufacturers.country,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.sellerId, sellerId))
      .orderBy(desc(sampleOrders.createdAt));

    res.json(rows.map(r => ({
      ...r.order,
      manufacturerName:    r.mfrName,
      manufacturerCountry: r.mfrCountry,
      createdAt: r.order.createdAt.toISOString(),
      updatedAt: r.order.updatedAt.toISOString(),
      shippedAt: r.order.shippedAt?.toISOString() ?? null,
      deliveredAt: r.order.deliveredAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list sample orders");
    res.status(500).json({ error: "Failed to list orders" });
  }
});

// ── POST /api/sample-orders ────────────────────────────────────────────────────
// Creates order + Stripe PaymentIntent (manufacturer must have Connect account).

router.post("/", async (req, res) => {
  try {
    const stripe = requireStripe();
    const sellerId = (req as any).clerkUserId as string;
    const { manufacturerId, threadId, orderType = "sample", title, description, quantity = 1, priceCents, notes } = req.body;

    if (!manufacturerId || !title || typeof priceCents !== "number" || priceCents <= 0) {
      res.status(400).json({ error: "manufacturerId, title, priceCents required" }); return;
    }

    const [mfr] = await db
      .select({ stripeAccountId: manufacturers.stripeAccountId })
      .from(manufacturers)
      .where(eq(manufacturers.id, manufacturerId))
      .limit(1);

    if (!mfr) { res.status(404).json({ error: "Manufacturer not found" }); return; }

    const platformFeeCents = computeApplicationFeeCents(priceCents);
    let stripePaymentIntentId: string | null = null;
    let clientSecret: string | null = null;

    if (mfr.stripeAccountId) {
      // Create payment intent with manufacturer as destination
      const intent = await stripe.paymentIntents.create({
        amount:                priceCents,
        currency:              "usd",
        application_fee_amount: platformFeeCents,
        transfer_data:         { destination: mfr.stripeAccountId },
        metadata: {
          orderType,
          sellerId,
          manufacturerId,
          title,
        },
      });
      stripePaymentIntentId = intent.id;
      clientSecret          = intent.client_secret;
    }

    const [order] = await db
      .insert(sampleOrders)
      .values({
        manufacturerId,
        sellerId,
        threadId:  threadId ?? null,
        orderType,
        title,
        description: description ?? null,
        quantity,
        priceCents,
        platformFeeCents,
        stripePaymentIntentId,
        notes: notes ?? null,
        status: stripePaymentIntentId ? "payment_received" : "payment_received",
      })
      .returning();

    res.status(201).json({
      ...order,
      clientSecret,
      hasConnect:  !!mfr.stripeAccountId,
      createdAt:   order.createdAt.toISOString(),
      updatedAt:   order.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create sample order");
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ── GET /api/sample-orders/:id ────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const [row] = await db
      .select({
        order:      sampleOrders,
        mfrName:    manufacturers.businessName,
        mfrCountry: manufacturers.country,
        mfrStripe:  manufacturers.stripeAccountId,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const stageIndex = ORDER_STAGES.indexOf(row.order.status as any);

    res.json({
      ...row.order,
      manufacturerName:     row.mfrName,
      manufacturerCountry:  row.mfrCountry,
      manufacturerHasStripe: !!row.mfrStripe,
      stageIndex,
      stages: ORDER_STAGES,
      createdAt:  row.order.createdAt.toISOString(),
      updatedAt:  row.order.updatedAt.toISOString(),
      shippedAt:  row.order.shippedAt?.toISOString() ?? null,
      deliveredAt: row.order.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to get sample order");
    res.status(500).json({ error: "Failed to get order" });
  }
});

// ── PATCH /api/sample-orders/:id/sample-detail ────────────────────────────────
// Persist seller sample-detail decisions and revision requests with the order.
// The tracker predates dedicated review/revision tables, so structured detail is
// kept in the order notes until those entities are introduced.
router.patch("/:id/sample-detail", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }
    if (auth.order!.sellerId !== clerkUserId) {
      res.status(403).json({ error: "Only the seller can submit sample decisions." }); return;
    }

    const { status, review, revision } = req.body as {
      status?: string; review?: unknown; revision?: unknown;
    };
    if (!review && !revision) {
      res.status(400).json({ error: "A review or revision request is required." }); return;
    }
    if (!["delivered", "review_needed"].includes(auth.order!.status)) {
      res.status(409).json({ error: "Sample must be delivered before a seller decision." }); return;
    }
    const reviewDecision = (review as { decision?: unknown } | undefined)?.decision;
    const expectedStatus = review
      ? reviewDecision === "approved" ? "approved" : reviewDecision === "rejected" ? "rejected" : "revision_requested"
      : "revision_requested";
    if (status !== expectedStatus) {
      res.status(400).json({ error: "Invalid seller decision transition." }); return;
    }
    let details: { review?: unknown; revisions?: unknown[] } = {};
    try { details = JSON.parse(auth.order!.notes ?? "{}"); } catch { /* retain legacy notes separately */ }
    if (review) details.review = review;
    if (revision) details.revisions = [...(details.revisions ?? []), revision];
    const [updated] = await db.update(sampleOrders)
      .set({
        status: expectedStatus,
        notes: JSON.stringify(details),
        updatedAt: new Date(),
      })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();
    res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to update sample order detail");
    res.status(500).json({ error: "Failed to update sample detail" });
  }
});

// ── PATCH /api/sample-orders/:id/advance ──────────────────────────────────────
// Manufacturer (or seller for demo) advances production stage.

router.patch("/:id/advance", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const [row] = await db
      .select({ order: sampleOrders, mfrClerkId: manufacturers.clerkId })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.id, req.params.id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Allow seller (for demo) or the manufacturer themselves
    const isSeller        = row.order.sellerId === clerkUserId;
    const isManufacturer  = row.mfrClerkId === clerkUserId;
    if (!isSeller && !isManufacturer) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const current = row.order.status;
    const idx     = ORDER_STAGES.indexOf(current as any);
    if (idx < 0 || idx >= ORDER_STAGES.length - 1) {
      res.status(400).json({ error: "Already at final stage" }); return;
    }

    const nextStage = ORDER_STAGES[idx + 1];
    const now       = new Date();
    const extra: Partial<typeof sampleOrders.$inferInsert> = {};
    if (nextStage === "shipped") extra.shippedAt = now;
    if (nextStage === "delivered") extra.deliveredAt = now;

    const [updated] = await db
      .update(sampleOrders)
      .set({ status: nextStage, ...extra, updatedAt: now })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      createdAt:  updated.createdAt.toISOString(),
      updatedAt:  updated.updatedAt.toISOString(),
      shippedAt:  updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to advance sample order stage");
    res.status(500).json({ error: "Failed to advance stage" });
  }
});

// ── PATCH /api/sample-orders/:id/tracking ─────────────────────────────────────
// Adds tracking number and marks shipped. Also triggers payout to manufacturer.

router.patch("/:id/tracking", async (req, res) => {
  try {
    const stripe      = requireStripe();
    const sellerId    = (req as any).clerkUserId as string;
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      res.status(400).json({ error: "trackingNumber required" }); return;
    }

    const [row] = await db
      .select({
        order:           sampleOrders,
        mfrStripeId:     manufacturers.stripeAccountId,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    const order = row.order;
    const now   = new Date();

    // Attempt Stripe payout to manufacturer Connect account if not already released
    let stripeTransferId: string | null = order.stripeTransferId;
    if (!order.payoutReleased && row.mfrStripeId && order.stripePaymentIntentId) {
      try {
        const netCents = order.priceCents - order.platformFeeCents;
        const transfer = await stripe.transfers.create({
          amount:      netCents,
          currency:    "usd",
          destination: row.mfrStripeId,
          transfer_group: `sample_${order.id}`,
          metadata: { sampleOrderId: order.id, sellerId },
        });
        stripeTransferId = transfer.id;
      } catch (e) {
        req.log.error({ err: e, orderId: order.id }, "Stripe transfer failed for sample order");
      }
    }

    const [updated] = await db
      .update(sampleOrders)
      .set({
        trackingNumber,
        carrier:         carrier ?? null,
        status:          "shipped",
        shippedAt:       now,
        payoutReleased:  !!stripeTransferId,
        stripeTransferId: stripeTransferId ?? order.stripeTransferId,
        updatedAt:       now,
      })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      createdAt:   updated.createdAt.toISOString(),
      updatedAt:   updated.updatedAt.toISOString(),
      shippedAt:   updated.shippedAt?.toISOString() ?? null,
      deliveredAt: updated.deliveredAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to add sample order tracking");
    res.status(500).json({ error: "Failed to add tracking" });
  }
});

// ── POST /api/sample-orders/:id/pay-from-wallet ───────────────────────────────
// Seller pays a bulk order from their drop wallet (no new card charge).

router.post("/:id/pay-from-wallet", async (req, res) => {
  try {
    const stripe   = requireStripe();
    const sellerId = (req as any).clerkUserId as string;
    const { walletId } = req.body;

    if (!walletId) { res.status(400).json({ error: "walletId required" }); return; }

    const [row] = await db
      .select({
        order:       sampleOrders,
        mfrStripeId: manufacturers.stripeAccountId,
        wallet:      dropWallets,
      })
      .from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .leftJoin(dropWallets, eq(dropWallets.id, walletId))
      .where(and(eq(sampleOrders.id, req.params.id), eq(sampleOrders.sellerId, sellerId)))
      .limit(1);

    if (!row?.order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!row.wallet) { res.status(404).json({ error: "Wallet not found" }); return; }

    const order  = row.order;
    const wallet = row.wallet;

    if (wallet.sellerId !== sellerId) {
      res.status(403).json({ error: "Wallet does not belong to you" }); return;
    }

    const availableCents = wallet.balanceCents - wallet.releasedCents - wallet.reservedCents;
    if (availableCents < order.priceCents) {
      res.status(400).json({
        error: `Insufficient wallet balance. Available: $${(availableCents / 100).toFixed(2)}, required: $${(order.priceCents / 100).toFixed(2)}`,
      }); return;
    }

    // Transfer from platform to manufacturer's Connect account
    let stripeTransferId: string | null = null;
    if (row.mfrStripeId) {
      const transfer = await stripe.transfers.create({
        amount:      order.priceCents,
        currency:    "usd",
        destination: row.mfrStripeId,
        transfer_group: wallet.stripeTransferGroup ?? `drop_${wallet.dropId}`,
        metadata: { sampleOrderId: order.id, sellerId, paymentSource: "drop_wallet" },
      });
      stripeTransferId = transfer.id;
    }

    // Debit wallet
    await db.transaction(async (tx) => {
      await tx
        .update(dropWallets)
        .set({
          reservedCents: wallet.reservedCents + order.priceCents,
          updatedAt:     new Date(),
        })
        .where(eq(dropWallets.id, walletId));

      await tx
        .insert(dropWalletTransactions)
        .values({
          walletId,
          type:             "bulk_payment",
          amountCents:      order.priceCents,
          sampleOrderId:    order.id,
          description:      `Bulk order payment: ${order.title}`,
          stripeTransferId: stripeTransferId ?? undefined,
        });
    });

    const [updated] = await db
      .update(sampleOrders)
      .set({
        walletId,
        stripeTransferId: stripeTransferId ?? undefined,
        updatedAt:        new Date(),
      })
      .where(eq(sampleOrders.id, req.params.id))
      .returning();

    res.json({
      ...updated,
      paidFromWallet: true,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to pay sample order from wallet");
    res.status(500).json({ error: "Failed to pay from wallet" });
  }
});

// ── POST /api/sample-orders/:id/images/request-upload ────────────────────────
// Returns a presigned GCS PUT URL plus the normalized objectPath. The client
// never parses the signed URL — the server supplies objectPath authoritatively.

router.post("/:id/images/request-upload", async (_req, res) => {
  res.status(410).json({ error: "Direct image uploads are no longer supported. Use the authenticated upload endpoint." });
});

// ── POST /api/sample-orders/:id/images/upload ─────────────────────────────────
// A raw, authenticated upload avoids an unconstrained client-direct storage write.
// The parser rejects bodies above 20 MB before any object is created.
router.post("/:id/images/upload", express.raw({ type: "image/*", limit: MAX_IMAGE_BYTES }), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;

    if (!contentType || !ACCEPTED_IMAGE_MIMES.has(contentType)) {
      res.status(400).json({
        error: `Invalid content type. Accepted: ${[...ACCEPTED_IMAGE_MIMES].join(", ")}`,
      });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: `Image too large. Maximum ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` });
      return;
    }
    if (!isValidImageBytes(bytes, contentType)) {
      res.status(400).json({ error: "Uploaded file content does not match its image type." });
      return;
    }

    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Order not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const objectPath = await objectStorage.createObjectEntityFromBuffer(bytes, contentType);
    try {
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkUserId, visibility: "private" });
      const currentUrls: string[] = Array.isArray(auth.order!.imageUrls) ? auth.order!.imageUrls as string[] : [];
      const [updated] = await db.update(sampleOrders)
        .set({ imageUrls: [...currentUrls, objectPath], updatedAt: new Date() })
        .where(eq(sampleOrders.id, req.params.id))
        .returning({ imageUrls: sampleOrders.imageUrls });
      const imageUrls = await Promise.all((updated.imageUrls as string[]).map(p => objectStorage.getObjectEntityDownloadURL(p)));
      res.status(201).json({ imageUrls });
    } catch (err) {
      await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Sample order image upload failed");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── POST /api/sample-orders/:id/images ───────────────────────────────────────
// Records an uploaded object path against the order and binds the object's ACL
// owner to the uploading user. Returns fresh signed display URLs.

router.post("/:id/images", async (_req, res) => {
  res.status(410).json({ error: "Direct image attachment is no longer supported. Upload the image through the authenticated upload endpoint." });
});

// ── GET /api/sample-orders/:id/images ─────────────────────────────────────────
// Lists the order's images as short-lived signed GET URLs so React Native
// <Image> can load them directly without an Authorization header.

router.get("/:id/images", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const auth = await loadAuthorizedOrder(req.params.id, clerkUserId);
    if (auth.status === 404) { res.status(404).json({ error: "Order not found" }); return; }
    if (auth.status === 403) { res.status(403).json({ error: "Forbidden" }); return; }

    const stored: string[] = Array.isArray(auth.order!.imageUrls)
      ? (auth.order!.imageUrls as string[]) : [];
    const displayUrls = await Promise.all(
      stored.map(p => objectStorage.getObjectEntityDownloadURL(p).catch(() => null)),
    );
    res.json({ imageUrls: displayUrls.filter((u): u is string => !!u) });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to list sample order images");
    res.status(500).json({ error: "Failed to list images" });
  }
});

export default router;

import express, { Router } from "express";
import { db, returns, orders, orderItems, users } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { bodyObject, cents, idParams, validateInput } from "../lib/commerceValidation";
import { orderGrossCents, refundOrder, RefundError } from "../lib/money/refunds";
import crypto from "crypto";
import { reversePurchasePointsOnce } from "./loyalty";
import { sendReturnStatusEmail } from "../lib/brandthreadEmail";
import { isChannelEnabledForUser } from "../lib/notificationChannels";
import { logger } from "../lib/logger";
import { publishNotification } from "./notifications-feed";
import { ObjectStorageService } from "../lib/objectStorage";
import { notifySellerReturnRequested } from "../lib/orderNotifications";
import { normalizeUploadedImage } from "../lib/productImageResize";

const router = Router();
const objectStorage = new ObjectStorageService();
router.use(requireAuth);

// ── Request schemas ──────────────────────────────────────────────────────────
// Type/size guards; the handlers keep their ownership, status and evidence
// checks. requestedItems only selects order lines by id — prices always come
// from the order itself — so its other fields pass through unchecked.
const returnIdParams = idParams("id");
const createReturnBody = bodyObject({
  orderId: z.string().max(160).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(5_000).nullish(),
  resolutionRequested: z.string().max(40).nullish(),
  evidenceUrls: z.array(z.string().max(2_048)).max(20).optional(),
  requestedItems: z.array(z.object({ lineItemId: z.string().max(160).nullish() }).passthrough()).max(200).optional(),
});
const returnStatusBody = bodyObject({
  status: z.string().max(20).optional(),
  sellerResponse: z.string().max(5_000).nullish(),
  // Upper-bounded again by the refund service against what was actually paid.
  refundAmountCents: cents.optional(),
  refundOnScan: z.boolean().optional(),
});

// ─── Evidence photos (item 108) ───────────────────────────────────────────────
// Buyers upload return photos first (POST /evidence), then send the returned
// private object paths as evidenceUrls. Paths live under the buyer's own
// prefix, so a request can only attach photos that buyer uploaded; readers
// (the buyer and the order's seller, already authorised by each route) get
// short-lived signed URLs, never the raw private path.
const EVIDENCE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_PHOTOS = 5;

export function evidencePrefix(buyerId: string): string {
  return `/objects/returns/${buyerId.replace(/[^A-Za-z0-9_-]/g, "_")}/`;
}

function hasImageSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

async function signEvidence<T extends { evidenceUrls: unknown }>(row: T): Promise<T> {
  const paths = Array.isArray(row.evidenceUrls) ? (row.evidenceUrls as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const urls = await Promise.all(paths.map((path) =>
    path.startsWith("/objects/") ? objectStorage.getObjectEntityDownloadURL(path).catch(() => null) : Promise.resolve(path),
  ));
  return { ...row, evidenceUrls: urls.filter((url): url is string => !!url) };
}

router.post(
  "/evidence",
  express.raw({ type: "image/*", limit: MAX_EVIDENCE_BYTES }),
  async (req, res): Promise<void> => {
    const buyerId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;
    if (!EVIDENCE_MIMES.has(contentType)) {
      res.status(400).json({ error: "Use a JPEG, PNG, or WebP photo." });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) {
      res.status(400).json({ error: "Photos must be no larger than 8 MB." });
      return;
    }
    if (!hasImageSignature(bytes, contentType)) {
      res.status(400).json({ error: "The uploaded file does not match its declared image type." });
      return;
    }
    let objectPath: string | null = null;
    try {
      const stored = await normalizeUploadedImage(bytes, contentType);
      objectPath = await objectStorage.createObjectEntityFromBuffer(stored.buffer, stored.contentType, `${evidencePrefix(buyerId)}${crypto.randomUUID()}`);
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: buyerId, visibility: "private" });
      res.status(201).json({ objectPath });
    } catch (err) {
      if (objectPath) await objectStorage.deleteObjectEntity(objectPath).catch(() => {});
      req.log.error({ err }, "Could not upload return evidence photo");
      res.status(500).json({ error: "The photo could not be uploaded" });
    }
  },
);

const RETURN_STATUS_COPY: Record<"pending" | "approved" | "denied" | "refunded", { type: string; title: string; body: (orderNumber: string, refundAmountCents?: number | null) => string }> = {
  pending: {
    type: "return_requested",
    title: "Return request received",
    body: (orderNumber) => `We received your return request for order #${orderNumber}.`,
  },
  approved: {
    type: "return_approved",
    title: "Return approved",
    body: (orderNumber) => `Your return for order #${orderNumber} was approved.`,
  },
  denied: {
    type: "return_denied",
    title: "Return update",
    body: (orderNumber) => `Your return for order #${orderNumber} was declined.`,
  },
  refunded: {
    type: "return_refunded",
    title: "Refund issued",
    body: (orderNumber, refundAmountCents) =>
      refundAmountCents
        ? `A refund of $${(refundAmountCents / 100).toFixed(2)} was issued for order #${orderNumber}.`
        : `A refund was issued for order #${orderNumber}.`,
  },
};

async function notifyReturnStatus(returnId: string, status: "pending" | "approved" | "denied" | "refunded", refundAmountCents?: number | null, sellerResponse?: string | null): Promise<void> {
  const [row] = await db
    .select({
      buyerId: returns.buyerId,
      buyerEmail: users.email,
      orderId: returns.orderId,
      orderNumber: orders.orderNumber,
    })
    .from(returns)
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .innerJoin(users, eq(users.clerkId, returns.buyerId))
    .where(eq(returns.id, returnId))
    .limit(1);

  if (!row?.buyerEmail) {
    return;
  }

  const copy = RETURN_STATUS_COPY[status];
  await publishNotification({
    userId: row.buyerId,
    category: "returns",
    type: copy.type,
    title: copy.title,
    body: copy.body(row.orderNumber, refundAmountCents),
    targetId: returnId,
    targetType: "return",
    cta: "View return",
  }).catch((err) => {
    logger.warn({ err, returnId, status }, "Return status push notification failed");
  });

  // Settings → Notifications → Email (Returns).
  if (!(await isChannelEnabledForUser(row.buyerId, "return", "email"))) return;

  const sent = await sendReturnStatusEmail({
    to: row.buyerEmail,
    orderNumber: row.orderNumber,
    status,
    refundAmountCents,
    sellerResponse,
    idempotencyKey: `return-status/${returnId}/${status}`,
  });
  if (!sent) {
    logger.warn({ returnId, status }, "Return status email delivery failed");
  }
}

// ─── BUYER ENDPOINTS ──────────────────────────────────────────────────────────

// POST / — buyer creates a return request
router.post("/", validateInput({ body: createReturnBody }), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { orderId, reason, notes, resolutionRequested, evidenceUrls, requestedItems } = req.body as {
      orderId?: string;
      reason?: string;
      notes?: string;
      resolutionRequested?: "refund" | "exchange" | "store_credit" | "replacement";
      evidenceUrls?: unknown;
      requestedItems?: unknown;
    };

    // 1. Validate required fields
    if (!orderId || !reason) {
      return res.status(400).json({ error: "orderId and reason are required" });
    }
    if (evidenceUrls !== undefined && (!Array.isArray(evidenceUrls) || evidenceUrls.some((url) => typeof url !== "string"))) {
      return res.status(400).json({ error: "evidenceUrls must be an array of strings" });
    }
    // Only photos this buyer uploaded through POST /evidence can be attached.
    const evidence = (evidenceUrls as string[] | undefined) ?? [];
    if (evidence.length > MAX_EVIDENCE_PHOTOS || evidence.some((url) => !url.startsWith(evidencePrefix(clerkUserId)))) {
      return res.status(400).json({ error: "Attach up to 5 photos uploaded with this return request" });
    }
    if (requestedItems !== undefined && !Array.isArray(requestedItems)) {
      return res.status(400).json({ error: "requestedItems must be an array" });
    }

    // 2. Look up the order
    const [order] = await db
      .select({
        id: orders.id,
        buyerId: orders.buyerId,
        ownerId: orders.ownerId,
        status: orders.status,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        stripePaymentIntentId: orders.stripePaymentIntentId,
      })
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 3. Verify the buyer owns this order
    if (order.buyerId !== clerkUserId) {
      return res.status(403).json({ error: "You are not the buyer of this order" });
    }

    // 4. Verify order status allows returns
    const returnableStatuses = ["shipped", "fulfilled", "delivered"];
    if (!returnableStatuses.includes(order.status)) {
      return res.status(400).json({
        error: `Cannot request a return for an order with status '${order.status}'. Order must be shipped, fulfilled, or delivered.`,
      });
    }

    // 5. Check for existing return request
    const [existingReturn] = await db
      .select({ id: returns.id })
      .from(returns)
      .where(
        and(
          eq(returns.orderId, orderId),
          // status NOT IN ('denied') — meaning active return exists
          sql`${returns.status} NOT IN ('denied')`
        )
      );

    if (existingReturn) {
      return res.status(409).json({ error: "A return request already exists for this order" });
    }

    // 6. The returned items come from the order itself (names, variants and
    //    prices the buyer actually paid) — never from client-sent prices.
    const lines = await db
      .select({ id: orderItems.id, productName: orderItems.productName, variantLabel: orderItems.variantLabel, quantity: orderItems.quantity, priceCents: orderItems.priceCents })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const wanted = new Set(
      (Array.isArray(requestedItems) ? requestedItems : [])
        .map((item: any) => (typeof item?.lineItemId === "string" ? item.lineItemId : null))
        .filter((value): value is string => !!value),
    );
    const chosen = lines.filter((line) => wanted.size === 0 || wanted.has(line.id));
    const items = (chosen.length > 0 ? chosen : lines).map((line) => ({
      lineItemId: line.id,
      productName: line.productName,
      variantTitle: line.variantLabel ?? undefined,
      quantity: line.quantity,
      unitPriceCents: line.priceCents,
    }));

    // 7. Insert the return
    const id = crypto.randomUUID();
    const [created] = await db
      .insert(returns)
      .values({
        id,
        orderId,
        buyerId: clerkUserId,
        sellerId: order.ownerId,
        reason,
        notes: notes ?? null,
        resolutionRequested: resolutionRequested ?? "refund",
        status: "pending",
        evidenceUrls: evidence,
        requestedItems: items,
      })
      .returning();

    // 8. Tell both sides: the buyer's confirmation, and the seller's
    //    "return requested" row (so a request never sits unseen).
    void notifyReturnStatus(created.id, "pending").catch((err) => {
      req.log.error({ err, returnId: created.id }, "Return request email delivery failed");
    });
    void notifySellerReturnRequested({
      sellerId: order.ownerId,
      buyerId: clerkUserId,
      returnId: created.id,
      orderNumber: order.orderNumber,
    });
    return res.status(201).json(await signEvidence(created));
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// GET /buyer — list all return requests for the authenticated buyer
router.get("/buyer", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const rows = await db
      .select({
        id: returns.id,
        orderId: returns.orderId,
        buyerId: returns.buyerId,
        sellerId: returns.sellerId,
        reason: returns.reason,
        notes: returns.notes,
        resolutionRequested: returns.resolutionRequested,
        status: returns.status,
        stripeRefundId: returns.stripeRefundId,
        refundAmountCents: returns.refundAmountCents,
        sellerResponse: returns.sellerResponse,
        evidenceUrls: returns.evidenceUrls,
        requestedItems: returns.requestedItems,
        returnLabelUrl: returns.returnLabelUrl,
        returnCarrier: returns.returnCarrier,
        returnTrackingNumber: returns.returnTrackingNumber,
        returnTrackingStatus: returns.returnTrackingStatus,
        refundOnScan: returns.refundOnScan,
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        sellerName: sql<string>`COALESCE(${users.brandName}, ${users.displayName}, 'Seller')`,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(users, eq(users.clerkId, returns.sellerId))
      .where(eq(returns.buyerId, clerkUserId))
      .orderBy(sql`${returns.createdAt} DESC`);

    return res.json(await Promise.all(rows.map(signEvidence)));
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// ─── SELLER ENDPOINTS ─────────────────────────────────────────────────────────

// GET / — list all return requests for orders owned by the authenticated seller
router.get("/", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const rows = await db
      .select({
        id: returns.id,
        orderId: returns.orderId,
        buyerId: returns.buyerId,
        sellerId: returns.sellerId,
        reason: returns.reason,
        notes: returns.notes,
        resolutionRequested: returns.resolutionRequested,
        status: returns.status,
        stripeRefundId: returns.stripeRefundId,
        refundAmountCents: returns.refundAmountCents,
        sellerResponse: returns.sellerResponse,
        evidenceUrls: returns.evidenceUrls,
        requestedItems: returns.requestedItems,
        returnLabelUrl: returns.returnLabelUrl,
        returnCarrier: returns.returnCarrier,
        returnTrackingNumber: returns.returnTrackingNumber,
        returnTrackingStatus: returns.returnTrackingStatus,
        refundOnScan: returns.refundOnScan,
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        buyerName: sql<string>`COALESCE(${users.displayName}, ${users.name}, 'Buyer')`,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .leftJoin(users, eq(users.clerkId, returns.buyerId))
      .where(eq(returns.sellerId, clerkUserId))
      .orderBy(sql`${returns.createdAt} DESC`);

    return res.json(await Promise.all(rows.map(signEvidence)));
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// GET /:id — get a specific return request (seller or buyer)
router.get("/:id", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;

    const [row] = await db
      .select({
        id: returns.id,
        orderId: returns.orderId,
        buyerId: returns.buyerId,
        sellerId: returns.sellerId,
        reason: returns.reason,
        notes: returns.notes,
        resolutionRequested: returns.resolutionRequested,
        status: returns.status,
        stripeRefundId: returns.stripeRefundId,
        refundAmountCents: returns.refundAmountCents,
        sellerResponse: returns.sellerResponse,
        evidenceUrls: returns.evidenceUrls,
        requestedItems: returns.requestedItems,
        returnLabelUrl: returns.returnLabelUrl,
        returnCarrier: returns.returnCarrier,
        returnTrackingNumber: returns.returnTrackingNumber,
        returnTrackingStatus: returns.returnTrackingStatus,
        refundOnScan: returns.refundOnScan,
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
        sellerName: sql<string>`(SELECT COALESCE(u.brand_name, u.display_name, u.name, 'Seller') FROM users u WHERE u.clerk_id = ${returns.sellerId} LIMIT 1)`,
        buyerName: sql<string>`(SELECT COALESCE(u.display_name, u.name, 'Buyer') FROM users u WHERE u.clerk_id = ${returns.buyerId} LIMIT 1)`,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .where(eq(returns.id, id));

    if (!row) {
      return res.status(404).json({ error: "Return not found" });
    }

    // Verify the requester is either the seller or the buyer
    if (row.sellerId !== clerkUserId && row.buyerId !== clerkUserId) {
      return res.status(403).json({ error: "Access denied" });
    }

    return res.json(await signEvidence(row));
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// PATCH /:id/status — seller approves or denies a return
router.patch("/:id/status", validateInput({ params: returnIdParams, body: returnStatusBody }), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const {
      status: newStatus,
      sellerResponse,
      refundAmountCents: bodyRefundAmount,
      refundOnScan,
    } = req.body as {
      status?: "approved" | "denied";
      sellerResponse?: string;
      refundAmountCents?: number;
      /** Approve now, refund when the carrier first scans the prepaid return label. */
      refundOnScan?: boolean;
    };

    if (!newStatus || !["approved", "denied"].includes(newStatus)) {
      return res.status(400).json({ error: "status must be 'approved' or 'denied'" });
    }

    // 1. Look up the return and verify seller ownership
    const [returnRow] = await db
      .select()
      .from(returns)
      .where(eq(returns.id, id));

    if (!returnRow) {
      return res.status(404).json({ error: "Return not found" });
    }

    if (returnRow.sellerId !== clerkUserId) {
      return res.status(403).json({ error: "Only the seller can update this return" });
    }

    if (newStatus === "approved") {
      if (bodyRefundAmount !== undefined && (!Number.isSafeInteger(bodyRefundAmount) || bodyRefundAmount <= 0)) {
        return res.status(400).json({ error: "refundAmountCents must be a positive whole number of cents" });
      }
      // A return is refunded once. Approving again only retries a refund
      // that could not be confirmed (same idempotency key → same refund).
      if (returnRow.status === "refunded") return res.json(returnRow);
      if (returnRow.status !== "pending" && returnRow.status !== "approved") {
        return res.status(409).json({ error: `This return is already ${returnRow.status}` });
      }

      if (refundOnScan === true) {
        // Approved, refund held until the buyer's parcel is scanned by the carrier
        // (see lib/returnLabels.ts). The refund itself is unchanged.
        const [approved] = await db.update(returns).set({
          status: "approved",
          sellerResponse: sellerResponse ?? null,
          refundAmountCents: bodyRefundAmount ?? null,
          refundOnScan: true,
          updatedAt: new Date(),
        }).where(and(eq(returns.id, id), inArray(returns.status, ["pending", "approved"]))).returning();
        if (approved && returnRow.status === "pending") {
          void notifyReturnStatus(id, "approved", null, approved.sellerResponse).catch((err) => {
            req.log.error({ err, returnId: id }, "Return status email delivery failed");
          });
        }
        return res.json(await signEvidence(approved ?? returnRow));
      }

      try {
        // The refund service caps the amount at what is still refundable,
        // pulls the seller's share back, returns the proportional 5% fee and
        // posts the ledger — exactly once for this return.
        await refundOrder({
          orderId: returnRow.orderId,
          amountCents: bodyRefundAmount,
          reason: "return_approved",
          initiatedBy: clerkUserId,
          idempotencyKey: `return/${id}`,
          precondition: (order) => {
            if (order.owner_id !== clerkUserId) {
              throw new RefundError("Only the seller can refund this order", 403, "FORBIDDEN");
            }
          },
          onSucceeded: async (tx, { order, amountCents, refundId }) => {
            await tx.update(returns).set({
              status: "refunded",
              refundAmountCents: amountCents,
              sellerResponse: sellerResponse ?? null,
              updatedAt: new Date(),
            }).where(eq(returns.id, id));
            // A partial return leaves the order as it was; a full refund of
            // a shipped order closes it.
            if (order.refunded_cents + amountCents >= orderGrossCents(order)) {
              await tx.update(orders).set({ status: "cancelled", updatedAt: new Date() })
                .where(and(eq(orders.id, order.id), inArray(orders.status, ["shipped", "delivered", "pending", "processing", "fulfilled"])));
            }
            if (order.buyer_id) {
              await reversePurchasePointsOnce({
                buyerId: order.buyer_id,
                orderId: order.id,
                referenceId: `${order.id}:return:${id}`,
                requestedPoints: Math.floor(amountCents / 100),
                note: `Purchase reward reversed after refund for order ${order.id} (refund ${refundId})`,
              }, tx);
            }
          },
        }).then(async (result) => {
          if (result.stripeRefundId) {
            await db.update(returns).set({ stripeRefundId: result.stripeRefundId }).where(eq(returns.id, id));
          }
        });

        const [updated] = await db.select().from(returns).where(eq(returns.id, id)).limit(1);
        void notifyReturnStatus(
          id,
          "refunded",
          updated.refundAmountCents,
          updated.sellerResponse,
        ).catch((err) => {
          req.log.error({ err, returnId: id }, "Return status email delivery failed");
        });
        return res.json(await signEvidence(updated));
      } catch (refundErr: any) {
        if (refundErr instanceof RefundError && refundErr.status < 500) {
          return res.status(refundErr.status).json({ error: refundErr.message, code: refundErr.code });
        }
        req.log.error({ err: refundErr, returnId: id }, "Return refund could not be completed");
        // Approved but not yet refunded; approving again retries safely.
        const [updated] = await db
          .update(returns)
          .set({
            status: "approved",
            sellerResponse: sellerResponse ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(returns.id, id), inArray(returns.status, ["pending", "approved"])))
          .returning();

        if (updated && returnRow.status === "pending") {
          void notifyReturnStatus(id, "approved", null, updated.sellerResponse).catch((err) => {
            req.log.error({ err, returnId: id }, "Return status email delivery failed");
          });
        }
        return res.json(updated ?? returnRow);
      }
    } else {
      // status === 'denied'
      // a. Update: status = 'denied', seller_response, updated_at = now()
      const [updated] = await db
        .update(returns)
        .set({
          status: "denied",
          sellerResponse: sellerResponse ?? null,
          updatedAt: new Date(),
        })
        // A refunded return cannot be "un-refunded" by denying it.
        .where(and(eq(returns.id, id), inArray(returns.status, ["pending", "approved"])))
        .returning();
      if (!updated) {
        return res.status(409).json({ error: `This return is already ${returnRow.status}` });
      }

      void notifyReturnStatus(id, "denied", null, updated.sellerResponse).catch((err) => {
        req.log.error({ err, returnId: id }, "Return status email delivery failed");
      });
      return res.json(updated);
    }
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

export default router;

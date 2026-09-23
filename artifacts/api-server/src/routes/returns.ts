import { Router } from "express";
import { db, returns, orders, users } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { orderGrossCents, refundOrder, RefundError } from "../lib/money/refunds";
import crypto from "crypto";
import { reversePurchasePointsOnce } from "./loyalty";
import { sendReturnStatusEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

async function notifyReturnStatus(returnId: string, status: "pending" | "approved" | "denied" | "refunded", refundAmountCents?: number | null, sellerResponse?: string | null): Promise<void> {
  const [row] = await db
    .select({
      buyerEmail: users.email,
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
router.post("/", async (req, res) => {
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

    // 6. Insert the return
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
        evidenceUrls: (evidenceUrls as string[] | undefined)?.slice(0, 5) ?? [],
        requestedItems: (requestedItems as any[] | undefined)?.slice(0, 100) ?? [],
      })
      .returning();

    // 7. Return created row
    void notifyReturnStatus(created.id, "pending").catch((err) => {
      req.log.error({ err, returnId: created.id }, "Return request email delivery failed");
    });
    return res.status(201).json(created);
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

    return res.json(rows);
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
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
      .where(eq(returns.sellerId, clerkUserId))
      .orderBy(sql`${returns.createdAt} DESC`);

    return res.json(rows);
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
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
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

    return res.json(row);
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

// PATCH /:id/status — seller approves or denies a return
router.patch("/:id/status", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    const {
      status: newStatus,
      sellerResponse,
      refundAmountCents: bodyRefundAmount,
    } = req.body as {
      status?: "approved" | "denied";
      sellerResponse?: string;
      refundAmountCents?: number;
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
        return res.json(updated);
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

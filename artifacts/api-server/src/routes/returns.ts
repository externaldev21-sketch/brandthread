import { Router } from "express";
import { db, returns, orders } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

// ─── BUYER ENDPOINTS ──────────────────────────────────────────────────────────

// POST / — buyer creates a return request
router.post("/", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { orderId, reason, notes, resolutionRequested } = req.body as {
      orderId?: string;
      reason?: string;
      notes?: string;
      resolutionRequested?: "refund" | "exchange" | "store_credit" | "replacement";
    };

    // 1. Validate required fields
    if (!orderId || !reason) {
      return res.status(400).json({ error: "orderId and reason are required" });
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
      })
      .returning();

    // 7. Return created row
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
        createdAt: returns.createdAt,
        updatedAt: returns.updatedAt,
        orderNumber: orders.orderNumber,
        totalCents: orders.totalCents,
      })
      .from(returns)
      .innerJoin(orders, eq(orders.id, returns.orderId))
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
      // a. Look up the order's stripe_payment_intent_id
      const [order] = await db
        .select({
          stripePaymentIntentId: orders.stripePaymentIntentId,
          totalCents: orders.totalCents,
        })
        .from(orders)
        .where(eq(orders.id, returnRow.orderId));

      if (!order) {
        return res.status(404).json({ error: "Associated order not found" });
      }

      // b. Determine refund amount
      const refundAmountCents = bodyRefundAmount ?? order.totalCents;

      try {
        // c. Issue Stripe refund
        const stripePaymentIntentId = order.stripePaymentIntentId;
        if (!stripePaymentIntentId) {
          return res.status(400).json({ error: "Order has no associated Stripe payment intent" });
        }

        const stripe = requireStripe();
        const refund = await stripe.refunds.create({
          payment_intent: stripePaymentIntentId,
          amount: refundAmountCents,
          reason: "requested_by_customer",
        });

        // d. Update the return to 'refunded'
        const [updated] = await db
          .update(returns)
          .set({
            status: "refunded",
            stripeRefundId: refund.id,
            refundAmountCents,
            sellerResponse: sellerResponse ?? null,
            updatedAt: new Date(),
          })
          .where(eq(returns.id, id))
          .returning();

        // e. Update the order status to 'cancelled'
        await db
          .update(orders)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(orders.id, returnRow.orderId));

        return res.json(updated);
      } catch (stripeErr: any) {
        // f. If Stripe fails, set status = 'approved' (not refunded yet)
        const [updated] = await db
          .update(returns)
          .set({
            status: "approved",
            sellerResponse: sellerResponse ?? null,
            updatedAt: new Date(),
          })
          .where(eq(returns.id, id))
          .returning();

        return res.json(updated);
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
        .where(eq(returns.id, id))
        .returning();

      return res.json(updated);
    }
  } catch (err: any) {
    const status = err.status ?? 500;
    return res.status(status).json({ error: err.message ?? "Internal server error" });
  }
});

export default router;

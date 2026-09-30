/** Database bindings for lib/risk/orderRiskStore.ts. */
import { db, orders } from "@workspace/db";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { logger } from "../logger";
import type { EnrichDeps, ReviewDeps } from "./orderRiskStore";

export const dbEnrichDeps: EnrichDeps = {
  async countPriorOrders({ buyerId, guestEmail, excludeOrderId }) {
    const who = buyerId ? eq(orders.buyerId, buyerId) : eq(orders.guestEmail, guestEmail ?? "");
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(who, ne(orders.id, excludeOrderId), sql`${orders.paidAt} IS NOT NULL`));
    return row?.n ?? 0;
  },
  async saveRisk(orderId, risk) {
    await db.update(orders).set({
      riskLevel: risk.level,
      riskScore: risk.score,
      riskFlags: risk.flags,
      riskReviewed: false,
    }).where(eq(orders.id, orderId));
  },
  onError(err, orderId) {
    logger.warn({ err, orderId }, "Order risk enrichment failed");
  },
};

export const dbReviewDeps: ReviewDeps = {
  async findOrders({ paymentIntentId, chargeId }) {
    const conds = [
      paymentIntentId ? eq(orders.stripePaymentIntentId, paymentIntentId) : undefined,
      chargeId ? eq(orders.stripeChargeId, chargeId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (conds.length === 0) return [];
    return db
      .select({
        id: orders.id,
        riskLevel: orders.riskLevel,
        riskFlags: orders.riskFlags,
        riskReviewed: orders.riskReviewed,
      })
      .from(orders)
      .where(conds.length === 1 ? conds[0] : or(...conds));
  },
  async updateRisk(orderId, patch) {
    await db.update(orders).set(patch).where(eq(orders.id, orderId));
  },
};

/**
 * Affiliate program data layer: program settings, creator codes (which reuse
 * the discount_codes engine), order attribution, commission ledger, refund
 * reversal and eligibility promotion. Pure rules live in ./commission.ts.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db, affiliateAttributions, affiliateCommissionEvents, affiliateCommissions, affiliateCreators,
  affiliatePrograms, discountCodes, users,
} from "@workspace/db";
import {
  attributionExpiry, codeStem, commissionBaseCents, commissionEligibleAt, computeCommissionCents, effectiveBps,
  isAttributionActive, isSelfReferral, statusAfterChange, totalReversalCents,
} from "./commission";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type ProgramRow = typeof affiliatePrograms.$inferSelect;
export type AffiliateRow = typeof affiliateCreators.$inferSelect;

export const PROGRAM_DEFAULTS = {
  enabled: false,
  defaultCommissionBps: 1000,
  buyerDiscountBps: 0,
  windowDays: 30,
  holdDays: 30,
  minPayoutCents: 2500,
  autoApprove: false,
} as const;

export async function getProgram(sellerId: string, executor: Tx = db): Promise<ProgramRow> {
  const [row] = await executor.select().from(affiliatePrograms).where(eq(affiliatePrograms.sellerId, sellerId)).limit(1);
  if (row) return row;
  const now = new Date();
  return { sellerId, ...PROGRAM_DEFAULTS, createdAt: now, updatedAt: now };
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomSuffix(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return out;
}

/** A code unused by any affiliate and by the seller's own discount codes. */
export async function generateUniqueCode(executor: Tx, sellerId: string, displayName: string): Promise<string> {
  const stem = codeStem(displayName);
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = stem && attempt < 8 ? `${stem}${randomSuffix(attempt < 4 ? 2 : 3)}` : randomSuffix(8);
    const [taken] = await executor.select({ id: affiliateCreators.id }).from(affiliateCreators)
      .where(eq(affiliateCreators.code, candidate)).limit(1);
    if (taken) continue;
    const [clash] = await executor.select({ id: discountCodes.id }).from(discountCodes)
      .where(and(eq(discountCodes.sellerId, sellerId), eq(discountCodes.code, candidate))).limit(1);
    if (!clash) return candidate;
  }
  throw new Error("Could not generate a unique affiliate code");
}

/**
 * Keep the creator's checkout code in step with the program by reusing the
 * normal discount_codes machinery (validateDiscountCode / recordDiscountCodeUse
 * in lib/discounts.ts). The code is live only while the program is on and the
 * creator is active; its buyer discount is the program's percentage (0 means
 * the code only tracks the sale).
 */
export async function syncDiscountCode(executor: Tx, affiliate: AffiliateRow, program: ProgramRow): Promise<string | null> {
  const shouldBeActive = program.enabled && affiliate.status === "active";
  const value = (program.buyerDiscountBps / 100).toFixed(2);
  if (affiliate.discountCodeId) {
    await executor.update(discountCodes)
      .set({ active: shouldBeActive, value, type: "percentage" })
      .where(eq(discountCodes.id, affiliate.discountCodeId));
    return affiliate.discountCodeId;
  }
  if (!shouldBeActive) return null;
  const id = crypto.randomUUID();
  await executor.insert(discountCodes).values({
    id, sellerId: affiliate.sellerId, code: affiliate.code, type: "percentage", value,
    appliesTo: "entire_store", active: true,
  });
  await executor.update(affiliateCreators)
    .set({ discountCodeId: id, updatedAt: new Date() }).where(eq(affiliateCreators.id, affiliate.id));
  return id;
}

export async function syncAllDiscountCodes(sellerId: string, program: ProgramRow): Promise<void> {
  const rows = await db.select().from(affiliateCreators).where(eq(affiliateCreators.sellerId, sellerId));
  for (const row of rows) await syncDiscountCode(db, row, program);
}

async function event(
  executor: Tx,
  c: { id: string; sellerId: string; creatorId: string },
  kind: string,
  amountCents: number,
  meta: Record<string, unknown> = {},
) {
  await executor.insert(affiliateCommissionEvents).values({
    commissionId: c.id, sellerId: c.sellerId, creatorId: c.creatorId, kind, amountCents, meta,
  });
}

export type AttributeOrderInput = {
  orderId: string;
  sellerId: string;
  buyerId: string | null;
  guestEmail?: string | null;
  subtotalCents: number;
  sellerDiscountCents: number;
  discountCodeId?: string | null;
  paidAt: Date;
};

/**
 * Record the commission for a freshly created, paid order. Returns the
 * commission row, or null when nothing qualifies (program off, no code/link,
 * creator not active, self-referral, zero commission). Idempotent: one
 * commission per order. Orders without an affiliate are never touched.
 */
export async function attributeOrder(executor: Tx, input: AttributeOrderInput) {
  const program = await getProgram(input.sellerId, executor);
  if (!program.enabled) return null;

  let affiliate: AffiliateRow | undefined;
  let source: "code" | "link" = "code";
  if (input.discountCodeId) {
    [affiliate] = await executor.select().from(affiliateCreators).where(and(
      eq(affiliateCreators.sellerId, input.sellerId),
      eq(affiliateCreators.discountCodeId, input.discountCodeId),
    )).limit(1);
  }
  if (!affiliate && input.buyerId) {
    const [attribution] = await executor.select().from(affiliateAttributions).where(and(
      eq(affiliateAttributions.buyerId, input.buyerId),
      eq(affiliateAttributions.sellerId, input.sellerId),
    )).limit(1);
    if (attribution && isAttributionActive({
      clickedAt: attribution.clickedAt, windowDays: program.windowDays, at: input.paidAt,
    })) {
      [affiliate] = await executor.select().from(affiliateCreators)
        .where(eq(affiliateCreators.id, attribution.affiliateId)).limit(1);
      source = "link";
    }
  }
  if (!affiliate || affiliate.status !== "active") return null;

  const [creator] = await executor.select({ email: users.email }).from(users)
    .where(eq(users.clerkId, affiliate.creatorId)).limit(1);
  let buyerEmail = input.guestEmail ?? null;
  if (input.buyerId) {
    const [buyer] = await executor.select({ email: users.email }).from(users)
      .where(eq(users.clerkId, input.buyerId)).limit(1);
    buyerEmail = buyer?.email ?? buyerEmail;
  }
  if (isSelfReferral({
    creatorId: affiliate.creatorId, sellerId: input.sellerId, buyerId: input.buyerId,
    creatorEmail: creator?.email, buyerEmail,
  })) return null;

  const baseCents = commissionBaseCents({
    subtotalCents: input.subtotalCents, sellerDiscountCents: input.sellerDiscountCents,
  });
  const bps = effectiveBps(program.defaultCommissionBps, affiliate.commissionBpsOverride);
  const amountCents = computeCommissionCents(baseCents, bps);
  if (amountCents <= 0) return null;

  const [commission] = await executor.insert(affiliateCommissions).values({
    affiliateId: affiliate.id, sellerId: input.sellerId, creatorId: affiliate.creatorId, orderId: input.orderId,
    source, baseCents, commissionBps: bps, amountCents, status: "pending",
  }).onConflictDoNothing().returning();
  if (!commission) return null;
  await event(executor, commission, "accrued", amountCents, { source, baseCents, bps });
  return commission;
}

/**
 * Re-derive the reversal for an order from the order row itself: full when the
 * order is cancelled/fully refunded, proportional for a partial refund.
 * Idempotent — only the increase over what is already reversed is applied.
 */
export async function reverseCommissionForOrder(executor: Tx, orderId: string, now = new Date()): Promise<number> {
  const res = await executor.execute(sql`
    SELECT c.id, c.seller_id, c.creator_id, c.amount_cents, c.reversed_cents, c.paid_cents, c.eligible_at,
           o.status AS order_status, o.funds_state, o.refunded_cents, o.gross_charged_cents, o.total_cents
    FROM affiliate_commissions c JOIN orders o ON o.id = c.order_id
    WHERE c.order_id = ${orderId}::uuid FOR UPDATE OF c
  `);
  const row = (res as unknown as { rows?: any[] }).rows?.[0];
  if (!row) return 0;
  const gross = Number(row.gross_charged_cents) > 0 ? Number(row.gross_charged_cents) : Number(row.total_cents);
  const target = totalReversalCents({
    amountCents: Number(row.amount_cents),
    grossCents: gross,
    refundedCents: Number(row.refunded_cents),
    cancelled: row.order_status === "cancelled" || row.funds_state === "refunded",
  });
  const delta = target - Number(row.reversed_cents);
  if (delta <= 0) return 0;
  const next = {
    amountCents: Number(row.amount_cents), reversedCents: target, paidCents: Number(row.paid_cents),
    eligibleAt: row.eligible_at ? new Date(row.eligible_at) : null, now,
  };
  await executor.update(affiliateCommissions).set({
    reversedCents: target, status: statusAfterChange(next), updatedAt: now,
  }).where(eq(affiliateCommissions.id, row.id));
  await event(executor, { id: row.id, sellerId: row.seller_id, creatorId: row.creator_id }, "reversed", -delta, {
    reason: row.order_status === "cancelled" ? "cancelled" : "refund", clawedBackFromPaid: Math.max(0, Number(row.paid_cents) - (next.amountCents - target)),
  });
  return delta;
}

/** Safety net: reverse every commission whose order was cancelled/refunded since. */
export async function reconcileReversals(now = new Date()): Promise<number> {
  const res = await db.execute(sql`
    SELECT c.order_id FROM affiliate_commissions c JOIN orders o ON o.id = c.order_id
    WHERE c.status <> 'reversed'
      AND (o.status = 'cancelled' OR o.funds_state = 'refunded' OR o.refunded_cents > 0)
  `);
  let n = 0;
  for (const r of ((res as unknown as { rows?: Array<{ order_id: string }> }).rows ?? [])) {
    n += await db.transaction((tx) => reverseCommissionForOrder(tx, r.order_id, now)) > 0 ? 1 : 0;
  }
  return n;
}

/**
 * pending -> payable once the order is delivered and the return window has
 * passed, unless a return/dispute is still open on the order.
 */
export async function promoteEligibleCommissions(now = new Date()): Promise<number> {
  await db.execute(sql`
    UPDATE affiliate_commissions c
       SET eligible_at = o.delivered_at + make_interval(days => COALESCE(p.hold_days, 30)), updated_at = ${now}
      FROM orders o LEFT JOIN affiliate_programs p ON p.seller_id = o.owner_id
     WHERE o.id = c.order_id AND c.status = 'pending' AND c.eligible_at IS NULL
       AND o.delivered_at IS NOT NULL AND o.status <> 'cancelled'
  `);
  const res = await db.execute(sql`
    UPDATE affiliate_commissions c SET status = 'payable', updated_at = ${now}
     WHERE c.status = 'pending' AND c.eligible_at IS NOT NULL AND c.eligible_at <= ${now}
       AND c.amount_cents - c.reversed_cents > 0
       AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = c.order_id AND r.status IN ('pending', 'approved'))
       AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = c.order_id AND d.status IN ('needs_response', 'under_review', 'warning_needs_response', 'warning_under_review'))
    RETURNING c.id, c.seller_id, c.creator_id, c.amount_cents
  `);
  const promoted = ((res as unknown as { rows?: any[] }).rows ?? []);
  for (const p of promoted) {
    await event(db, { id: p.id, sellerId: p.seller_id, creatorId: p.creator_id }, "marked_payable", Number(p.amount_cents));
  }
  return promoted.length;
}

export { commissionEligibleAt };

/**
 * Shared discount-code rule engine.
 *
 * One place decides whether a code is valid and how much it's worth, so the
 * buyer-facing "apply code" preview (discount-codes.ts GET /validate) and the
 * actual checkout charge (buyer.ts POST /checkout/session) can never disagree.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, checkoutSessions, discountCodes, discountCodeUses, liveStreams } from "@workspace/db";
import type { InferSelectModel } from "drizzle-orm";
import { countCustomerUses, hasPriorPaidOrder, resolveCollectionProductIds } from "./discountLookups";

export type DiscountCodeRow = InferSelectModel<typeof discountCodes>;

export type DiscountRejectionCode =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MAX_USES_REACHED"
  | "ALREADY_USED_BY_CUSTOMER"
  | "MIN_ORDER_NOT_MET"
  | "MIN_QUANTITY_NOT_MET"
  | "FIRST_ORDER_ONLY"
  | "CUSTOMER_LIMIT_REACHED"
  | "NO_ELIGIBLE_ITEMS"
  | "LIVE_ONLY"
  | "LIVE_ENDED";

export class DiscountValidationError extends Error {
  constructor(readonly code: DiscountRejectionCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "DiscountValidationError";
  }
}

export interface CartLine {
  productId: string;
  priceCents: number;
  quantity: number;
  /** Cents already taken off this line (a seller bundle); the code works on what is left. */
  reductionCents?: number;
}

const lineCents = (l: CartLine) => Math.max(0, l.priceCents * l.quantity - Math.max(0, l.reductionCents ?? 0));

export interface DiscountApplication {
  discount: DiscountCodeRow;
  /** Amount actually taken off this order, in cents. Never exceeds the eligible subtotal. */
  appliedAmountCents: number;
  /** Human-readable summary, e.g. "20% off", "$10 off", "Free shipping". */
  description: string;
  /** True when this is a free_shipping code — the caller should zero out shipping too. */
  freeShipping: boolean;
}

/** Cart lines the code is allowed to discount (all of them for entire_store). */
function eligibleLines(discount: DiscountCodeRow, lines: CartLine[], collectionProductIds: Set<string>): CartLine[] {
  if (discount.appliesTo === "specific_products") {
    const productIds = Array.isArray(discount.productIds) ? new Set(discount.productIds as string[]) : new Set<string>();
    return lines.filter((l) => productIds.has(l.productId));
  }
  if (discount.appliesTo === "collections") return lines.filter((l) => collectionProductIds.has(l.productId));
  return lines;
}

/**
 * Live-only codes (discount_codes.live_stream_id): valid solely for that
 * stream and solely while it is live. Pure so the rule is unit-testable.
 * Returns null when the code may be used.
 */
export function liveScopeRejection(
  discountLiveStreamId: string | null | undefined,
  requestLiveStreamId: string | null | undefined,
  streamStatus: string | null | undefined,
): { code: "LIVE_ONLY" | "LIVE_ENDED"; message: string } | null {
  if (!discountLiveStreamId) return null;
  if (!requestLiveStreamId || requestLiveStreamId.toLowerCase() !== discountLiveStreamId.toLowerCase()) {
    return { code: "LIVE_ONLY", message: "This code only works during the live it was shared in." };
  }
  if (streamStatus !== "live") {
    return { code: "LIVE_ENDED", message: "This code was only valid during the live, which has ended." };
  }
  return null;
}

/**
 * Validates a discount code against a specific seller, buyer/customer and cart,
 * throwing DiscountValidationError on any rule failure. Never mutates state —
 * callers apply and record usage separately (see recordDiscountCodeUse).
 */
export async function validateDiscountCode(input: {
  sellerId: string;
  code: string;
  customerKey: string;
  cartSubtotalCents: number;
  lines: CartLine[];
  now?: Date;
  /** The live stream the buyer is shopping from, if any (required for live-only codes). */
  liveStreamId?: string | null;
}): Promise<DiscountApplication> {
  const now = input.now ?? new Date();
  const normalizedCode = input.code.trim().toUpperCase();

  const [discount] = await db
    .select()
    .from(discountCodes)
    .where(and(eq(discountCodes.sellerId, input.sellerId), eq(discountCodes.code, normalizedCode)))
    .limit(1);

  if (!discount) {
    throw new DiscountValidationError("NOT_FOUND", "This discount code doesn't exist.");
  }
  if (!discount.active) {
    throw new DiscountValidationError("INACTIVE", "This discount code is paused.");
  }
  if (discount.liveStreamId) {
    const requested = input.liveStreamId ?? null;
    let streamStatus: string | null = null;
    if (requested && requested.toLowerCase() === discount.liveStreamId.toLowerCase()) {
      const [stream] = await db
        .select({ status: liveStreams.status })
        .from(liveStreams)
        .where(eq(liveStreams.id, discount.liveStreamId))
        .limit(1);
      streamStatus = stream?.status ?? null;
    }
    const rejection = liveScopeRejection(discount.liveStreamId, requested, streamStatus);
    if (rejection) throw new DiscountValidationError(rejection.code, rejection.message);
  }
  if (discount.startsAt && discount.startsAt.getTime() > now.getTime()) {
    throw new DiscountValidationError("NOT_STARTED", "This discount code isn't active yet.");
  }
  if (discount.expiresAt && discount.expiresAt.getTime() <= now.getTime()) {
    throw new DiscountValidationError("EXPIRED", "This discount code has expired.");
  }
  if (discount.maxUses != null && discount.usesCount >= discount.maxUses) {
    throw new DiscountValidationError("MAX_USES_REACHED", "This discount code has reached its usage limit.");
  }
  if (discount.oneUsePerCustomer) {
    const [priorUse] = await db
      .select({ id: discountCodeUses.id })
      .from(discountCodeUses)
      .where(and(eq(discountCodeUses.discountCodeId, discount.id), eq(discountCodeUses.customerKey, input.customerKey)))
      .limit(1);
    if (priorUse) {
      throw new DiscountValidationError("ALREADY_USED_BY_CUSTOMER", "You've already used this discount code.");
    }
  }
  if (input.cartSubtotalCents < (discount.minOrderCents ?? 0)) {
    throw new DiscountValidationError("MIN_ORDER_NOT_MET", `Spend $${((discount.minOrderCents ?? 0) / 100).toFixed(2)} or more to use this code.`, {
      minOrderCents: discount.minOrderCents,
    });
  }
  if (discount.maxUsesPerCustomer != null && discount.maxUsesPerCustomer > 0) {
    const used = await countCustomerUses(discount.id, input.customerKey);
    if (used >= discount.maxUsesPerCustomer) {
      throw new DiscountValidationError(
        "CUSTOMER_LIMIT_REACHED",
        discount.maxUsesPerCustomer === 1
          ? "You've already used this discount code."
          : `You've used this code the maximum ${discount.maxUsesPerCustomer} times.`,
      );
    }
  }
  if (discount.firstOrderOnly && (await hasPriorPaidOrder(input.sellerId, input.customerKey))) {
    throw new DiscountValidationError("FIRST_ORDER_ONLY", "This code is only valid on your first order with this shop.");
  }

  const collectionIds = Array.isArray(discount.collectionIds) ? (discount.collectionIds as string[]) : [];
  const collectionProductIds = discount.appliesTo === "collections"
    ? await resolveCollectionProductIds(discount.sellerId, collectionIds)
    : new Set<string>();
  const eligible = eligibleLines(discount, input.lines, collectionProductIds);
  if ((discount.minQuantity ?? 0) > 0) {
    const qty = eligible.reduce((sum, l) => sum + l.quantity, 0);
    if (qty < discount.minQuantity) {
      const short = discount.minQuantity - qty;
      throw new DiscountValidationError("MIN_QUANTITY_NOT_MET", `Add ${short} more ${short === 1 ? "item" : "items"} to use this code.`, {
        minQuantity: discount.minQuantity,
      });
    }
  }
  const eligibleCents = eligible.reduce((sum, l) => sum + lineCents(l), 0);
  if (eligibleCents <= 0 && discount.type !== "free_shipping") {
    throw new DiscountValidationError("NO_ELIGIBLE_ITEMS", discount.appliesTo === "entire_store" ? "No items in your cart are eligible for this code." : "This code only applies to selected products in this shop.");
  }

  const value = Number(discount.value);
  let appliedAmountCents = 0;
  let description = "";
  let freeShipping = false;

  switch (discount.type) {
    case "percentage":
      appliedAmountCents = Math.round(eligibleCents * (value / 100));
      description = `${value}% off`;
      break;
    case "fixed":
      appliedAmountCents = Math.min(Math.round(value * 100), eligibleCents);
      description = `$${value.toFixed(2)} off`;
      break;
    case "free_shipping":
      appliedAmountCents = 0;
      freeShipping = true;
      description = "Free shipping";
      break;
    case "free_item": {
      const cheapest = eligible.reduce<CartLine | null>((min, l) => (!min || l.priceCents < min.priceCents ? l : min), null);
      appliedAmountCents = cheapest ? Math.min(cheapest.priceCents, eligibleCents) : 0;
      description = "Free item";
      break;
    }
    default:
      appliedAmountCents = 0;
  }

  return { discount, appliedAmountCents, description, freeShipping };
}

/** Records one redemption — called once, inside the order-creation transaction, after payment succeeds. */
export async function recordDiscountCodeUse(
  tx: Pick<typeof db, "insert" | "update">,
  input: { discountCodeId: string; sellerId: string; customerKey: string; orderId: string; appliedAmountCents: number },
): Promise<void> {
  await tx.insert(discountCodeUses).values({
    discountCodeId: input.discountCodeId,
    sellerId: input.sellerId,
    customerKey: input.customerKey,
    orderId: input.orderId,
    appliedAmountCents: input.appliedAmountCents,
  });
  await tx
    .update(discountCodes)
    .set({ usesCount: sql`${discountCodes.usesCount} + 1` })
    .where(eq(discountCodes.id, input.discountCodeId));
}

/** How long an unpaid checkout can still complete (Stripe Checkout's maximum session lifetime). */
const OPEN_CHECKOUT_WINDOW_HOURS = 24;

/**
 * Holds one use of a capped code for the checkout about to be created. Run
 * in the transaction that inserts that checkout row.
 *
 * `validateDiscountCode` only compares `usesCount` (paid orders) with
 * `maxUses`, so several buyers paying at once could all pass and the code was
 * redeemed past its limit. Here the code's row is locked, and checkouts other
 * customers still have open with this code count against the limit too — one
 * slot per customer, so a buyer retrying their own checkout doesn't use up
 * extra. Expired or failed checkouts release theirs (releaseCheckoutDiscount).
 */
export async function reserveDiscountCapacity(
  tx: Pick<typeof db, "execute">,
  input: { discountCodeId: string; customerKey: string },
): Promise<void> {
  const locked = await tx.execute(sql`
    SELECT max_uses, uses_count FROM discount_codes WHERE id = ${input.discountCodeId} FOR UPDATE
  `);
  const code = ((locked as unknown as { rows?: Array<{ max_uses: number | null; uses_count: number }> }).rows ?? [])[0];
  if (!code || code.max_uses == null) return;
  // Holder keys use the same shape as customerKey: the buyer id, or
  // "guest:<email>" for a guest checkout (customerKeyOf in checkout-intent.ts).
  const open = await tx.execute(sql`
    SELECT count(DISTINCT coalesce(cs.buyer_id, 'guest:' || cs.guest_email))::int AS holders
    FROM checkout_sessions cs
    WHERE cs.discount_code_id = ${input.discountCodeId}
      AND cs.created_at > now() - make_interval(hours => ${OPEN_CHECKOUT_WINDOW_HOURS})
      AND coalesce(cs.buyer_id, 'guest:' || cs.guest_email, '') <> ${input.customerKey}
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.stripe_checkout_session_id = cs.stripe_session_id
      )
  `);
  const holders = Number(((open as unknown as { rows?: Array<{ holders: number }> }).rows ?? [])[0]?.holders ?? 0);
  if (code.uses_count + holders >= code.max_uses) {
    throw new DiscountValidationError(
      "MAX_USES_REACHED",
      "This discount code has reached its usage limit.",
    );
  }
}

/** An unpaid checkout ended (expired, failed, cancelled): it no longer holds a use of its code. */
export async function releaseCheckoutDiscount(
  tx: Pick<typeof db, "update">,
  checkoutSessionId: string,
): Promise<void> {
  await tx.update(checkoutSessions)
    .set({ discountCodeId: null })
    .where(and(eq(checkoutSessions.id, checkoutSessionId), sql`NOT EXISTS (
      SELECT 1 FROM orders o WHERE o.stripe_checkout_session_id = ${checkoutSessions.stripeSessionId}
    )`));
}

/**
 * Shared discount-code rule engine.
 *
 * One place decides whether a code is valid and how much it's worth, so the
 * buyer-facing "apply code" preview (discount-codes.ts GET /validate) and the
 * actual checkout charge (buyer.ts POST /checkout/session) can never disagree.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, discountCodes, discountCodeUses } from "@workspace/db";
import type { InferSelectModel } from "drizzle-orm";

export type DiscountCodeRow = InferSelectModel<typeof discountCodes>;

export type DiscountRejectionCode =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MAX_USES_REACHED"
  | "ALREADY_USED_BY_CUSTOMER"
  | "MIN_ORDER_NOT_MET"
  | "NO_ELIGIBLE_ITEMS";

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
}

export interface DiscountApplication {
  discount: DiscountCodeRow;
  /** Amount actually taken off this order, in cents. Never exceeds the eligible subtotal. */
  appliedAmountCents: number;
  /** Human-readable summary, e.g. "20% off", "$10 off", "Free shipping". */
  description: string;
  /** True when this is a free_shipping code — the caller should zero out shipping too. */
  freeShipping: boolean;
}

/** Sum of cart lines the code is allowed to discount (all of them for entire_store). */
function eligibleSubtotalCents(discount: DiscountCodeRow, lines: CartLine[]): number {
  const productIds = Array.isArray(discount.productIds) ? new Set(discount.productIds as string[]) : new Set<string>();
  const eligible = discount.appliesTo === "specific_products"
    ? lines.filter((l) => productIds.has(l.productId))
    : lines;
  return eligible.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
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
    throw new DiscountValidationError("MIN_ORDER_NOT_MET", `Add ${((discount.minOrderCents ?? 0) / 100).toFixed(2)} more to use this code.`, {
      minOrderCents: discount.minOrderCents,
    });
  }

  const eligibleCents = eligibleSubtotalCents(discount, input.lines);
  if (eligibleCents <= 0 && discount.type !== "free_shipping") {
    throw new DiscountValidationError("NO_ELIGIBLE_ITEMS", "No items in your cart are eligible for this code.");
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
      const productIds = Array.isArray(discount.productIds) ? new Set(discount.productIds as string[]) : new Set<string>();
      const eligibleLines = discount.appliesTo === "specific_products"
        ? input.lines.filter((l) => productIds.has(l.productId))
        : input.lines;
      const cheapest = eligibleLines.reduce<CartLine | null>((min, l) => (!min || l.priceCents < min.priceCents ? l : min), null);
      appliedAmountCents = cheapest ? cheapest.priceCents : 0;
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

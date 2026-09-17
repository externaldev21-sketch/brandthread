/**
 * Authoritative predicate for buyer review eligibility.
 *
 * Rules (canonical post-purchase flow):
 *  1. orderId is required — reviews must be tied to a real purchase.
 *  2. The order must be owned by the requesting buyer (buyerId).
 *  3. The order status must be "delivered" or "fulfilled".
 *  4. The supplied sellerId must match the order's ownerId.
 *  5. When productId is supplied it must appear on an order line item
 *     (via order_items → product_variants → products).
 *
 * All failures return a { status, error } object so the caller can respond
 * without leaking whether a foreign order exists.
 */
import { db, orders, orderItems, productVariants } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type ReviewAuthResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

export interface ReviewAuthInput {
  orderId:    string;
  buyerId:    string;  // req.clerkUserId
  sellerId:   string;
  productId?: string | null;
}

export async function assertReviewOrderAuth(
  input: ReviewAuthInput,
): Promise<ReviewAuthResult> {
  const { orderId, buyerId, sellerId, productId } = input;

  // Fetch order — select only the fields we need for auth.
  const [order] = await db
    .select({
      id:      orders.id,
      buyerId: orders.buyerId,
      ownerId: orders.ownerId,
      status:  orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  // Rule 1+2: order must exist AND belong to this buyer.
  // We return 403 in both cases to avoid leaking order existence to other buyers.
  if (!order || order.buyerId !== buyerId) {
    return { ok: false, status: 403, error: "Not eligible to review this order" };
  }

  // Rule 3: must be delivered/fulfilled.
  if (!["delivered", "fulfilled"].includes(order.status ?? "")) {
    return { ok: false, status: 400, error: "Can only review a delivered or fulfilled order" };
  }

  // Rule 4: sellerId must match the order's seller (ownerId).
  if (order.ownerId !== sellerId) {
    return { ok: false, status: 400, error: "Seller does not match this order" };
  }

  // Rule 5: productId (when supplied) must be a line item on this order.
  if (productId) {
    const [item] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(productVariants.productId, productId),
        ),
      )
      .limit(1);

    if (!item) {
      return { ok: false, status: 400, error: "Product is not on this order" };
    }
  }

  return { ok: true };
}

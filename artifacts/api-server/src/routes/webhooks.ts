/**
 * Stripe webhook handler — raw body required for signature verification.
 * Mounted at /api/webhooks (before express.json() middleware).
 */
import { Router, type Request, type Response } from "express";
import { db, orders, orderItems, productVariants, products, users } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../lib/stripe";

const router = Router();

// POST /api/webhooks/stripe — raw body, no Clerk auth
router.post("/stripe", async (req: Request, res: Response) => {
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || !STRIPE_WEBHOOK_SECRET) {
    res.status(400).json({ error: "Missing stripe-signature or webhook secret" });
    return;
  }

  let event: any;
  try {
    // req.body is a Buffer because this route uses express.raw()
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    res.status(400).json({ error: `Webhook error: ${err.message}` });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;

      default:
        // Ignore unhandled events
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: any) {
  const buyerId: string = session.client_reference_id;
  const sessionId: string = session.id;
  const paymentIntentId: string | null = session.payment_intent ?? null;
  const metadata: Record<string, string> = session.metadata ?? {};

  if (!buyerId) {
    console.error("checkout.session.completed: missing client_reference_id");
    return;
  }

  // Guard: idempotency — skip if order already created for this session
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionId))
    .limit(1);

  if (existing) {
    console.log(`Order already exists for session ${sessionId}, skipping`);
    return;
  }

  // Reconstruct cart items from metadata
  const itemCount = parseInt(metadata["itemCount"] ?? "0", 10);
  if (itemCount === 0) {
    console.error("checkout.session.completed: no items in metadata");
    return;
  }

  type CartItem = {
    variantId: string;
    productName: string;
    variantLabel: string;
    quantity: number;
    priceCents: number;
  };

  const cartItems: CartItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    cartItems.push({
      variantId: metadata[`item_${i}_variantId`],
      productName: metadata[`item_${i}_productName`],
      variantLabel: metadata[`item_${i}_variantLabel`] ?? "",
      quantity: parseInt(metadata[`item_${i}_quantity`] ?? "1", 10),
      priceCents: parseInt(metadata[`item_${i}_priceCents`] ?? "0", 10),
    });
  }

  const subtotalCents = cartItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  const shippingCents = 0; // Shipping collected separately; update when shipping rates are added
  const totalCents = subtotalCents + shippingCents;

  // Determine seller owner (from first variant's product)
  let ownerId = "";
  if (cartItems[0]?.variantId) {
    const [row] = await db
      .select({ ownerId: products.ownerId })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(productVariants.id, cartItems[0].variantId))
      .limit(1);
    ownerId = row?.ownerId ?? "";
  }

  await db.transaction(async (tx) => {
    // Generate order number
    const countRes = await tx.execute(sql`
      SELECT count(*)::int AS c FROM orders WHERE owner_id = ${ownerId}
    `);
    const count: number = (countRes as any).rows?.[0]?.c ?? 0;
    const orderNumber = `BT-${String(count + 1).padStart(5, "0")}`;

    // Shipping address from Stripe session (if collected)
    const shipDetails = session.shipping_details;
    const shippingAddress = shipDetails?.address
      ? {
          name: shipDetails.name ?? undefined,
          street: shipDetails.address.line1 ?? "",
          city: shipDetails.address.city ?? "",
          state: shipDetails.address.state ?? "",
          zip: shipDetails.address.postal_code ?? "",
          country: shipDetails.address.country ?? "US",
        }
      : undefined;

    // Insert order
    const [order] = await tx
      .insert(orders)
      .values({
        ownerId,
        buyerId,
        orderNumber,
        status: "pending",
        totalCents,
        subtotalCents,
        shippingCents,
        stripePaymentIntentId: paymentIntentId,
        stripeCheckoutSessionId: sessionId,
        ...(shippingAddress && { shippingAddress }),
      })
      .returning();

    // Insert order items
    await tx.insert(orderItems).values(
      cartItems.map((item) => ({
        orderId: order.id,
        variantId: item.variantId,
        productName: item.productName,
        variantLabel: item.variantLabel || null,
        quantity: item.quantity,
        priceCents: item.priceCents,
      }))
    );

    // Decrement stock (best-effort; stock was validated at session creation)
    for (const item of cartItems) {
      if (item.variantId) {
        await tx.execute(sql`
          UPDATE product_variants
          SET stock = GREATEST(stock - ${item.quantity}, 0)
          WHERE id = ${item.variantId}
        `);
      }
    }
  });

  console.log(`Order created for buyer ${buyerId}, session ${sessionId}`);
}

async function handleAccountUpdated(account: any) {
  const stripeAccountId: string = account.id;
  const chargesEnabled: boolean = account.charges_enabled ?? false;
  const payoutsEnabled: boolean = account.payouts_enabled ?? false;
  const detailsSubmitted: boolean = account.details_submitted ?? false;

  const status = chargesEnabled && payoutsEnabled
    ? "active"
    : detailsSubmitted
    ? "restricted"
    : "pending";

  await db
    .update(users)
    .set({
      stripeAccountStatus: status,
      updatedAt: new Date(),
    })
    .where(eq(users.stripeAccountId, stripeAccountId));

  console.log(`Connect account ${stripeAccountId} updated — status: ${status}`);
}

export default router;

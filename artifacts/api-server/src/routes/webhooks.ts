/**
 * Stripe webhook handler — raw body required for signature verification.
 * Mounted at /api/webhooks (before express.json() middleware).
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users, notificationsFeed, disputes,
  dropWallets, dropWalletTransactions, freelancers, freelancerJobs,
} from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { stripe, STRIPE_WEBHOOK_SECRET } from "../lib/stripe";
import { refundJobPayment } from "../lib/freelancerEscrow";

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
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    res.status(400).json({ error: `Webhook error: ${err.message}` });
    return;
  }

  try {
    switch (event.type) {
      // Synchronous payment (cards, wallets) — already captured at session completion
      case "checkout.session.completed":
        if (event.data.object.payment_status === "paid") {
          await handleCheckoutPaid(event.data.object);
        }
        // payment_status === 'unpaid' means async method chosen → wait for below
        break;

      // Delayed payment method (ACH bank debit, etc.) captured successfully
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutPaid(event.data.object);
        break;

      // Delayed payment failed — log; no order was created, nothing to clean up
      case "checkout.session.async_payment_failed":
        console.warn(
          `Async payment failed for session ${event.data.object.id}`,
          event.data.object.payment_status,
        );
        break;

      case "account.updated":
        await handleAccountUpdated(event.data.object);
        break;

      // ── Seller platform subscription (billed to seller's own payment method) ──
      // These events are completely separate from buyer checkout and Connect.
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;

      // ── Stripe Identity — seller ID verification ───────────────────────────
      case "identity.verification_session.verified":
        await handleIdentityVerified(event.data.object);
        break;

      case "identity.verification_session.requires_input":
        await handleIdentityFailed(event.data.object);
        break;

      case "identity.verification_session.processing":
        // Status already set to 'pending' when the session was created.
        // No DB update needed — the verified/requires_input event follows.
        break;

      // ── Stripe Disputes / Chargebacks ─────────────────────────────────────
      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object);
        break;

      case "charge.dispute.updated":
        await handleDisputeUpdated(event.data.object);
        break;

      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object);
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Creates an order for a confirmed, paid Checkout Session.
 *
 * Cart is read from the checkout_sessions DB record (keyed by csRef in
 * metadata) — no per-field Stripe metadata keys, no 50-key limit.
 *
 * Stock is handled all-or-nothing:
 *   1. Aggregate quantities by variantId (guards against duplicate lines
 *      that could each pass individual stock checks).
 *   2. Lock all variant rows with SELECT FOR UPDATE in deterministic
 *      (sorted) order to prevent deadlocks on concurrent checkouts.
 *   3. Verify every aggregated line has sufficient stock.
 *   3a. ALL pass → decrement all and create order with status "pending".
 *   3b. ANY fail → create order with status "refund_pending", decrement
 *       NOTHING (no inventory lost for a refunded order).
 *   4. Stripe refund is issued outside the transaction so the order record
 *      is always committed (visible for audit/manual review).
 *
 * The unique index on stripe_checkout_session_id plus the early-exit guard
 * ensure at-most-once order creation even on webhook retries.
 */
export async function handleCheckoutPaid(session: any) {
  const sessionId: string   = session.id;
  const buyerId:   string   = session.client_reference_id ?? "";
  const piId:      string | null = session.payment_intent ?? null;
  const metadata:  Record<string, string> = session.metadata ?? {};
  const csRef:     string | undefined = metadata["csRef"];

  // Freelancer job escrow payments are a separate flow from cart orders.
  // Fast path: session metadata (set at session creation). Fallback: match by
  // the session id persisted on the job row at creation — dispatch works even
  // for a session whose metadata is missing or stripped.
  if (metadata["freelancerJobId"]) {
    await handleFreelancerJobPaid(session, metadata["freelancerJobId"]);
    return;
  }
  const [freelancerJobBySession] = await db
    .select({ id: freelancerJobs.id })
    .from(freelancerJobs)
    .where(eq(freelancerJobs.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (freelancerJobBySession) {
    await handleFreelancerJobPaid(session, freelancerJobBySession.id);
    return;
  }

  if (!buyerId) {
    console.error("checkout paid: missing client_reference_id", sessionId);
    return;
  }

  // ── Fast-path idempotency check (unique DB index is the hard guarantee) ──
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (existing) {
    console.log(`Order already exists for session ${sessionId}, skipping`);
    return;
  }

  // ── Load cart from server-side record ────────────────────────────────────
  let csRecord: (typeof checkoutSessions.$inferSelect) | undefined;
  if (csRef) {
    [csRecord] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, csRef))
      .limit(1);
  }
  // Fallback: also try lookup by stripe session id (back-filled by buyer route)
  if (!csRecord) {
    [csRecord] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, sessionId))
      .limit(1);
  }
  if (!csRecord) {
    console.error(`checkout paid: no server-side cart record for session ${sessionId}`);
    return;
  }

  type CartItem = {
    variantId:    string;
    productName:  string;
    variantLabel: string;
    quantity:     number;
    priceCents:   number;
  };

  const rawItems = csRecord.items as CartItem[];
  const ownerId  = csRecord.sellerId;

  // ── Aggregate quantities by variantId (all-or-nothing requires per-variant totals)
  // Even if buyer.ts rejected duplicates, aggregate here as a safety net.
  const aggregated = new Map<string, CartItem>();
  for (const item of rawItems) {
    const existing = aggregated.get(item.variantId);
    if (existing) {
      aggregated.set(item.variantId, { ...existing, quantity: existing.quantity + item.quantity });
    } else {
      aggregated.set(item.variantId, { ...item });
    }
  }
  const cartItems = [...aggregated.values()];

  const subtotalCents = cartItems.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  // Use Stripe's authoritative charged total; fall back to computed subtotal if absent.
  // This ensures the stored order total always matches the amount Stripe captured.
  const totalCents    = typeof session.amount_total === "number" ? session.amount_total : subtotalCents;
  // Derive shipping as the difference between what Stripe charged and item subtotal
  const shippingCents = Math.max(0, totalCents - subtotalCents);

  // Prefer the buyer-provided address stored in the server-side checkout record
  // (captured before Stripe was opened, so it always has the address).
  // Fall back to session.shipping_details if the csRecord address is missing
  // (e.g. older sessions or sessions created with shipping_address_collection).
  let shippingAddress: { name?: string; street: string; city: string; state: string; zip: string; country: string } | undefined;
  if (csRecord.shippingAddress && (csRecord.shippingAddress as any).street) {
    const sa = csRecord.shippingAddress as any;
    shippingAddress = {
      name:    sa.name    ?? undefined,
      street:  sa.street,
      city:    sa.city,
      state:   sa.state,
      zip:     sa.zip,
      country: sa.country ?? "US",
    };
  } else {
    const shipDetails = session.shipping_details;
    if (shipDetails?.address) {
      shippingAddress = {
        name:    shipDetails.name ?? undefined,
        street:  shipDetails.address.line1 ?? "",
        city:    shipDetails.address.city ?? "",
        state:   shipDetails.address.state ?? "",
        zip:     shipDetails.address.postal_code ?? "",
        country: shipDetails.address.country ?? "US",
      };
    }
  }

  // ── All-or-nothing stock reservation inside transaction ───────────────────
  let oversoldItems: string[] = [];
  let createdOrderId: string | null = null;

  await db.transaction(async (tx) => {
    // Step 1: Lock all variant rows in deterministic order (prevents deadlocks)
    const sortedItems = [...cartItems].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    );
    const stockMap = new Map<string, number>();
    for (const item of sortedItems) {
      const result = await tx.execute(
        sql`SELECT stock FROM product_variants WHERE id = ${item.variantId}::uuid FOR UPDATE`,
      );
      const rows = (result as any).rows ?? [];
      stockMap.set(item.variantId, rows[0]?.stock ?? 0);
    }

    // Step 2: Check ALL aggregated quantities against locked stock
    for (const item of cartItems) {
      const available = stockMap.get(item.variantId) ?? 0;
      if (available < item.quantity) {
        oversoldItems.push(item.productName);
      }
    }

    // Step 3: Generate order number
    const countRes = await tx.execute(
      sql`SELECT count(*)::int AS c FROM orders WHERE owner_id = ${ownerId}`,
    );
    const count: number = (countRes as any).rows?.[0]?.c ?? 0;
    const orderNumber   = `BT-${String(count + 1).padStart(5, "0")}`;

    // Step 4: Insert order — pending if stock OK, refund_pending if oversold
    const dropId: string | undefined = metadata["dropId"];
    const [order] = await tx
      .insert(orders)
      .values({
        ownerId,
        buyerId,
        orderNumber,
        status:                  oversoldItems.length > 0 ? "refund_pending" : "pending",
        totalCents,
        subtotalCents,
        shippingCents,
        stripePaymentIntentId:   piId,
        stripeCheckoutSessionId: sessionId,
        ...(shippingAddress && { shippingAddress }),
        ...(dropId ? { dropId } : {}),
      })
      .returning();
    createdOrderId = order.id;

    // Step 5: Insert order items (from original cart, not aggregated map, to preserve line detail)
    await tx.insert(orderItems).values(
      rawItems.map((item) => ({
        orderId:      order.id,
        variantId:    item.variantId,
        productName:  item.productName,
        variantLabel: item.variantLabel || null,
        quantity:     item.quantity,
        priceCents:   item.priceCents,
      })),
    );

    // Step 6: Decrement stock ONLY if every aggregated line passed (all-or-nothing)
    if (oversoldItems.length === 0) {
      for (const item of cartItems) {
        await tx.execute(
          sql`UPDATE product_variants SET stock = stock - ${item.quantity} WHERE id = ${item.variantId}::uuid`,
        );
      }
    }
    // If oversold: zero decrements committed — inventory stays intact.
    // Stripe refund is issued outside this transaction.

    // ── Low-stock notifications ───────────────────────────────────────────────────
    // For each decremented variant, check if stock fell below threshold
    if (oversoldItems.length === 0) {
      for (const item of cartItems) {
        if (!item.variantId) continue;
        try {
          const [variant] = await tx
            .select({
              stock: productVariants.stock,
              lowStockThreshold: productVariants.lowStockThreshold,
              productName: products.name,
              ownerId: products.ownerId,
            })
            .from(productVariants)
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(eq(productVariants.id, item.variantId as any))
            .limit(1);

          if (
            variant &&
            variant.lowStockThreshold !== null &&
            variant.lowStockThreshold > 0 &&
            variant.stock >= 0 &&
            variant.stock <= variant.lowStockThreshold
          ) {
            const isZero = variant.stock === 0;
            await tx.insert(notificationsFeed).values({
              id: crypto.randomUUID(),
              userId: variant.ownerId,
              type: isZero ? 'out_of_stock' : 'low_stock',
              title: isZero ? 'Out of stock' : 'Low stock alert',
              body: isZero
                ? `${variant.productName} is now out of stock.`
                : `${variant.productName} has only ${variant.stock} units left.`,
              targetId: item.variantId,
              targetType: 'variant',
              isRead: false,
              createdAt: new Date(),
            });
          }
        } catch {
          // Non-critical — don't fail the order over a notification error
        }
      }
    }
  });

  // ── Issue Stripe refund for oversold orders ───────────────────────────────
  if (oversoldItems.length > 0) {
    console.error(
      `Oversold after payment — issuing refund. Session: ${sessionId}. Items: ${oversoldItems.join(", ")}`,
    );
    if (piId && stripe) {
      try {
        await stripe.refunds.create({
          payment_intent: piId,
          metadata: {
            reason:         "oversold",
            oversold_items: oversoldItems.join(", "),
            session_id:     sessionId,
          },
        });
        console.log(`Refund issued for payment intent ${piId}`);
      } catch (refundErr) {
        // Refund failed — order remains "refund_pending" for manual review
        console.error(`Failed to issue automatic refund for ${piId}:`, refundErr);
      }
    }
  } else {
    console.log(`Order created for buyer ${buyerId}, session ${sessionId}`);

    // ── Auto-credit drop wallet (Fix #1) ───────────────────────────────────
    // If this order is part of a drop, credit the drop's escrow wallet so
    // the per-order release-order endpoint has funds to transfer at ship time.
    const dropId: string | undefined = metadata["dropId"];
    if (dropId && createdOrderId) {
      try {
        await creditDropWallet(dropId, createdOrderId, subtotalCents, piId);
      } catch (walletErr) {
        // Non-fatal — log for manual recovery; order record is committed
        console.error(`Auto-credit drop wallet failed for order ${createdOrderId}:`, walletErr);
      }
    }
  }
}

// ── Drop wallet auto-credit helper ──────────────────────────────────────────
// Uses SELECT FOR UPDATE to prevent concurrent duplicate deposits.
async function creditDropWallet(
  dropId: string,
  orderId: string,
  amountCents: number,
  stripePaymentIntentId: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock wallet row — prevents concurrent deposits from double-crediting
    const lockResult = await tx.execute(
      sql`SELECT id, balance_cents FROM drop_wallets WHERE drop_id = ${dropId}::uuid FOR UPDATE LIMIT 1`,
    );
    const walletRow = (lockResult as any).rows?.[0];
    if (!walletRow) {
      console.warn(`creditDropWallet: no wallet found for drop ${dropId}`);
      return;
    }

    // Idempotency guard — skip if this order was already deposited
    const already = await tx.execute(
      sql`SELECT id FROM drop_wallet_transactions WHERE wallet_id = ${walletRow.id}::uuid AND order_id = ${orderId}::uuid AND type = 'deposit' LIMIT 1`,
    );
    if ((already as any).rows?.length > 0) {
      console.log(`creditDropWallet: order ${orderId} already deposited — skipping`);
      return;
    }

    // Atomic balance increment (avoids read-modify-write race)
    await tx.execute(
      sql`UPDATE drop_wallets SET balance_cents = balance_cents + ${amountCents}, updated_at = NOW() WHERE id = ${walletRow.id}::uuid`,
    );

    await tx.insert(dropWalletTransactions).values({
      walletId:         walletRow.id as string,
      type:             "deposit",
      amountCents,
      orderId,
      description:      "Buyer order payment (auto-credited on checkout.session.completed)",
      stripeTransferId: stripePaymentIntentId ?? undefined,
    });
  });
}

// ── Seller subscription handlers ────────────────────────────────────────────

/**
 * Handles customer.subscription.created and customer.subscription.updated.
 * Looks up the seller by stripeCustomerId and syncs their subscription status.
 */
async function handleSubscriptionUpdated(sub: any) {
  const customerId: string =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    console.warn("subscription.updated: missing customer id");
    return;
  }

  // Determine plan from the price lookup_key on the first subscription item
  const lookupKey: string | undefined = sub.items?.data?.[0]?.price?.lookup_key;
  const planId =
    lookupKey === "brandthread_pro_monthly"    ? "pro"
    : lookupKey === "brandthread_growth_monthly" ? "growth"
    : undefined; // don't overwrite plan if lookup_key absent (e.g. expand not requested)

  const periodEnd: Date | null = sub.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;

  await db.update(users).set({
    subscriptionId:     sub.id,
    subscriptionStatus: sub.status,
    ...(planId    ? { subscriptionPlanId:     planId    } : {}),
    ...(periodEnd ? { subscriptionPeriodEnd:  periodEnd } : {}),
    updatedAt: new Date(),
  }).where(eq(users.stripeCustomerId, customerId));

  console.log(
    `Subscription ${sub.id} updated — customer: ${customerId}, status: ${sub.status}`,
  );
}

/**
 * Handles customer.subscription.deleted.
 * Marks the seller as canceled and resets them to the free Starter plan.
 */
async function handleSubscriptionDeleted(sub: any) {
  const customerId: string =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return;

  await db.update(users).set({
    subscriptionStatus: "canceled",
    subscriptionPlanId: "starter",
    updatedAt: new Date(),
  }).where(eq(users.stripeCustomerId, customerId));

  console.log(`Subscription ${sub.id} deleted — customer: ${customerId}`);
}

// ─── Stripe Identity handlers ─────────────────────────────────────────────────

async function handleIdentityVerified(session: any) {
  const clerkId: string | undefined = session.metadata?.seller_clerk_id;
  if (!clerkId) {
    console.warn("identity.verification_session.verified: missing seller_clerk_id in metadata", session.id);
    return;
  }

  await db
    .update(users)
    .set({
      verified: true,
      verificationStatus: "verified",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  // Push notification to seller
  try {
    await db.insert(notificationsFeed).values({
      userId: clerkId,
      category: "system",
      type: "verification_verified",
      title: "You're a verified seller! ✓",
      body: "Your identity has been confirmed. Your verified badge is now live on your storefront.",
    });
  } catch {
    // Non-critical
  }

  console.log(`Seller ${clerkId} verified via Stripe Identity (session ${session.id})`);
}

async function handleIdentityFailed(session: any) {
  const clerkId: string | undefined = session.metadata?.seller_clerk_id;
  if (!clerkId) {
    console.warn("identity.verification_session.requires_input: missing seller_clerk_id in metadata", session.id);
    return;
  }

  const lastError = session.last_error;
  const reason = lastError?.reason ?? "unknown";

  await db
    .update(users)
    .set({
      verificationStatus: "failed",
      updatedAt: new Date(),
    })
    .where(eq(users.clerkId, clerkId));

  // Notify seller so they know to retry
  try {
    await db.insert(notificationsFeed).values({
      userId: clerkId,
      category: "system",
      type: "verification_failed",
      title: "Verification needs attention",
      body: "We couldn't verify your identity. Open the app to try again.",
    });
  } catch {
    // Non-critical
  }

  console.log(`Seller ${clerkId} identity verification failed (session ${session.id}, reason: ${reason})`);
}

// ─── Dispute handlers ─────────────────────────────────────────────────────────

function mapDisputeStatus(s: string): string {
  switch (s) {
    case "needs_response":           return "needs_response";
    case "under_review":             return "under_review";
    case "warning_needs_response":   return "needs_response";
    case "warning_under_review":     return "under_review";
    case "warning_closed":           return "closed";
    case "charge_refunded":          return "closed";
    case "won":                      return "won";
    case "lost":                     return "lost";
    default:                         return s;
  }
}

/** Resolve the seller's clerkId from a Stripe paymentIntentId or chargeId. */
async function resolveSellerAndOrder(
  paymentIntentId: string | null,
  chargeId: string | null,
): Promise<{ sellerId: string; orderId: string | null }> {
  // Try to find matching order by payment intent ID
  if (paymentIntentId) {
    const [ord] = await db
      .select({ id: orders.id, ownerId: orders.ownerId })
      .from(orders)
      .where(eq(orders.stripePaymentIntentId, paymentIntentId))
      .limit(1);
    if (ord) return { sellerId: ord.ownerId, orderId: ord.id };
  }
  return { sellerId: "unknown", orderId: null };
}

async function handleDisputeCreated(dispute: any) {
  const dueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000)
    : null;

  const { sellerId, orderId } = await resolveSellerAndOrder(
    dispute.payment_intent ?? null,
    dispute.charge ?? null,
  );

  // Build human-readable claim from reason
  const reasonLabels: Record<string, string> = {
    credit_not_processed:    "Customer claims they did not receive a refund.",
    duplicate:               "Customer claims this is a duplicate charge.",
    fraudulent:              "Customer reports this as an unauthorized charge.",
    general:                 "Customer filed a general dispute.",
    product_not_received:    "Customer claims the product was not received.",
    product_unacceptable:    "Customer claims the product was defective or not as described.",
    subscription_canceled:   "Customer claims they canceled their subscription.",
    unrecognized:            "Customer does not recognize this charge.",
  };
  const customerClaim = reasonLabels[dispute.reason] ?? `Dispute filed: ${dispute.reason}`;

  await db
    .insert(disputes)
    .values({
      stripeDisputeId:       dispute.id,
      stripeChargeId:        dispute.charge ?? null,
      stripePaymentIntentId: dispute.payment_intent ?? null,
      orderId,
      sellerId,
      amountCents:           dispute.amount,
      currency:              dispute.currency,
      reason:                dispute.reason,
      status:                mapDisputeStatus(dispute.status),
      evidenceDueBy:         dueBy,
      stripeEvidenceDetails: dispute.evidence_details ?? {},
      isChargeRefundable:    dispute.is_charge_refundable ?? true,
      networkReasonCode:     dispute.network_reason_code ?? null,
      customerClaim,
    })
    .onConflictDoNothing();

  console.log(`Dispute created: ${dispute.id} — seller ${sellerId} — reason ${dispute.reason}`);
}

async function handleDisputeUpdated(stripeDispute: any) {
  const dueBy = stripeDispute.evidence_details?.due_by
    ? new Date(stripeDispute.evidence_details.due_by * 1000)
    : null;

  await db
    .update(disputes)
    .set({
      status:                mapDisputeStatus(stripeDispute.status),
      evidenceDueBy:         dueBy,
      stripeEvidenceDetails: stripeDispute.evidence_details ?? {},
      updatedAt:             new Date(),
    })
    .where(eq(disputes.stripeDisputeId, stripeDispute.id));

  console.log(`Dispute updated: ${stripeDispute.id} — status ${stripeDispute.status}`);
}

async function handleDisputeClosed(stripeDispute: any) {
  await db
    .update(disputes)
    .set({
      status:    mapDisputeStatus(stripeDispute.status),
      updatedAt: new Date(),
    })
    .where(eq(disputes.stripeDisputeId, stripeDispute.id));

  console.log(`Dispute closed: ${stripeDispute.id} — outcome ${stripeDispute.status}`);
}

/**
 * checkout.session.completed for a freelancer job escrow payment.
 * Marks the job paid; the payout transfer happens later, when the freelancer
 * completes the job (see routes/freelancer-jobs.ts).
 */
async function handleFreelancerJobPaid(session: any, jobIdOverride?: string) {
  const jobId: string = jobIdOverride ?? session.metadata?.["freelancerJobId"] ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    console.error("freelancer job paid: invalid job id in metadata", session.id);
    return;
  }
  const piId: string | null =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const [updated] = await db
    .update(freelancerJobs)
    .set({
      paymentStatus: "paid",
      ...(piId ? { stripePaymentIntentId: piId } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(freelancerJobs.id, jobId),
        eq(freelancerJobs.paymentStatus, "unpaid"),
        ne(freelancerJobs.status, "cancelled"),
      ),
    )
    .returning({ id: freelancerJobs.id });

  if (updated) {
    console.log(`Freelancer job ${jobId} marked paid (session ${session.id})`);
    return;
  }

  // Late payment for a cancelled job → refund it instead of recording it.
  const [job] = await db
    .select()
    .from(freelancerJobs)
    .where(eq(freelancerJobs.id, jobId))
    .limit(1);
  if (job && job.status === "cancelled" && job.paymentStatus !== "refunded" && piId && stripe) {
    try {
      await refundJobPayment(stripe, {
        jobId,
        paymentIntentId: piId,
        context: "webhook_after_cancel",
      });
      await db
        .update(freelancerJobs)
        .set({ paymentStatus: "refunded", stripePaymentIntentId: piId, updatedAt: new Date() })
        .where(eq(freelancerJobs.id, jobId));
      console.log(`Freelancer job ${jobId} was cancelled — late payment refunded`);
    } catch (refundErr) {
      console.error(`freelancer job ${jobId}: late-payment refund failed`, refundErr);
    }
    return;
  }

  console.log(`Freelancer job ${jobId} already paid or not found, skipping`);
}

async function handleAccountUpdated(account: any) {
  const stripeAccountId: string  = account.id;
  const chargesEnabled:  boolean = account.charges_enabled ?? false;
  const payoutsEnabled:  boolean = account.payouts_enabled ?? false;
  const detailsSubmitted: boolean = account.details_submitted ?? false;

  const status =
    chargesEnabled && payoutsEnabled
      ? "active"
      : detailsSubmitted
      ? "restricted"
      : "pending";

  await db
    .update(users)
    .set({ stripeAccountStatus: status, updatedAt: new Date() })
    .where(eq(users.stripeAccountId, stripeAccountId));

  // Freelancer rows track the same Connect account status (the account may be
  // shared with a seller profile, or freelancer-only).
  await db
    .update(freelancers)
    .set({ stripeAccountStatus: status, updatedAt: new Date() })
    .where(eq(freelancers.stripeAccountId, stripeAccountId));

  console.log(`Connect account ${stripeAccountId} updated — status: ${status}`);
}

export default router;

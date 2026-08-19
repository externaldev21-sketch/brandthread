/**
 * Seller subscription / platform billing endpoints.
 * Mounted at /api/seller/subscription — all routes require Clerk auth.
 *
 * Three tiers:
 *   starter  $29/mo  — storefront, AI store builder, 25 products, standard checkout
 *   growth   $79/mo  — everything in starter + unlimited products, AI Design Studio,
 *                       manufacturer hub, live shopping, 3 team seats, boosts
 *   scale   $199/mo  — everything in growth + unlimited team seats, advanced analytics,
 *                       priority manufacturer intros, white-glove support, early access
 *
 * All subscriptions start with a 5-day free trial. Card is collected upfront so the
 * trial auto-converts to paid on day 6 without any further seller action.
 *
 * These charges go directly to the seller's own payment method via a standard
 * Stripe Subscription. They are completely separate from Stripe Connect, which
 * handles buyer → seller payment-splitting. Buyers are never touched here.
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ─── Plan catalogue (server-side source of truth) ─────────────────────────────

const PLAN_CATALOGUE = {
  starter: { amountCents: 2900,  name: "Brandthread Starter Plan", lookupKey: "brandthread_starter_monthly" },
  growth:  { amountCents: 7900,  name: "Brandthread Growth Plan",  lookupKey: "brandthread_growth_monthly"  },
  scale:   { amountCents: 19900, name: "Brandthread Scale Plan",   lookupKey: "brandthread_scale_monthly"   },
} as const;

type PlanId = keyof typeof PLAN_CATALOGUE;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find or create a Stripe Price for the given plan using lookup_key so the
 * same price is reused across calls and deployments.
 *
 * IMPORTANT: if the catalogue price for a plan changes (e.g. Growth $29 → $79)
 * the existing Stripe Price has the old amount. We detect this by comparing
 * unit_amount and create a new Price with transfer_lookup_key:true so that:
 *  - the lookup key moves to the new correct-amount price
 *  - future calls find the right price
 *  - legacy subscribers keep their old price ID until their subscription is updated
 */
async function ensurePrice(stripe: any, planId: PlanId): Promise<string> {
  const cfg = PLAN_CATALOGUE[planId];
  const existing = await stripe.prices.list({ lookup_keys: [cfg.lookupKey], limit: 1 });

  if (existing.data.length > 0) {
    const found = existing.data[0];
    // Amount matches — safe to reuse
    if (found.unit_amount === cfg.amountCents) return found.id;
    // Amount mismatch: catalogue was updated but old Stripe Price still holds the key.
    // Create a corrected price and transfer the lookup_key to it.
    console.warn(
      `ensurePrice: lookup_key ${cfg.lookupKey} has stale amount ${found.unit_amount} cents ` +
      `(expected ${cfg.amountCents}). Creating corrected price with transfer_lookup_key.`,
    );
  }

  const price = await stripe.prices.create({
    currency:             "usd",
    unit_amount:          cfg.amountCents,
    recurring:            { interval: "month" },
    product_data:         { name: cfg.name },
    lookup_key:           cfg.lookupKey,
    transfer_lookup_key:  existing.data.length > 0, // move key from stale price to new one
  });
  return price.id;
}

/**
 * Find or create a Stripe Customer for the seller's own billing account.
 * Stored in users.stripe_customer_id — distinct from stripe_account_id (Connect).
 */
async function ensureCustomer(stripe: any, clerkUserId: string): Promise<string> {
  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId, email: users.email, name: users.name })
    .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);

  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email:    user.email,
    name:     user.name,
    metadata: { clerkUserId },
  });

  await db
    .update(users)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(users.clerkId, clerkUserId));

  return customer.id;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/seller/subscription/status
 * Returns the seller's current plan, subscription status, renewal date,
 * trial end date, and payment method label.
 * If no subscription exists, returns starter/none.
 */
router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({
        subscriptionId:        users.subscriptionId,
        subscriptionStatus:    users.subscriptionStatus,
        subscriptionPeriodEnd: users.subscriptionPeriodEnd,
        subscriptionPlanId:    users.subscriptionPlanId,
        stripeCustomerId:      users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.subscriptionId) {
      res.json({ plan: "starter", status: "none", renewsOn: null, trialEnd: null, amountCents: 0, paymentMethodLabel: null });
      return;
    }

    // Fetch live status directly from Stripe for accuracy.
    // Cast to `any` because the Stripe SDK's Response<Subscription> generic
    // doesn't expose current_period_end or expanded fields at the TS level.
    const sub = await (stripe.subscriptions.retrieve as any)(user.subscriptionId, {
      expand: ["default_payment_method"],
    });

    const periodEnd  = sub.current_period_end  ? new Date(sub.current_period_end  * 1000) : null;
    const trialEnd   = sub.trial_end           ? new Date(sub.trial_end           * 1000) : null;
    const renewsOn   = periodEnd
      ? periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;
    const trialEndFmt = trialEnd
      ? trialEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;

    const planId = user.subscriptionPlanId ?? "starter";
    const amountCents = PLAN_CATALOGUE[planId as PlanId]?.amountCents ?? 0;

    // Payment method label — card brand + last4
    const pm  = sub.default_payment_method;
    const pmLabel = pm?.card
      ? `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} ···· ${pm.card.last4}`
      : pm?.type
        ? pm.type
        : null;

    res.json({
      plan:               planId,
      status:             sub.status,
      renewsOn,
      trialEnd:           trialEndFmt,
      amountCents,
      paymentMethodLabel: pmLabel,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    console.error(err);
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

/**
 * POST /api/seller/subscription/checkout
 * Body: { planId: 'starter' | 'growth' | 'scale' }
 *
 * • If the seller already has an active or trialing subscription, updates it
 *   in-place (Stripe subscription items update + prorations) instead of creating
 *   a new Checkout session — this prevents concurrent duplicate subscriptions.
 * • If no active subscription exists, creates a Stripe Checkout Session in
 *   subscription mode with a 5-day free trial. Card collected upfront so the
 *   trial auto-converts to paid on day 6.
 * Returns { url } for redirect or { updated: true } for in-place update.
 */
router.post("/checkout", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const { planId } = req.body;

    if (!planId || !(planId in PLAN_CATALOGUE)) {
      res.status(400).json({ error: "planId must be 'starter', 'growth', or 'scale'" });
      return;
    }

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    const returnBase = `https://${devDomain}/api-server`;

    // Check for an existing active or trialing subscription so we don't create a duplicate.
    const [user] = await db
      .select({ subscriptionId: users.subscriptionId })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);

    if (user?.subscriptionId) {
      try {
        const sub = await (stripe.subscriptions.retrieve as any)(user.subscriptionId);
        if (sub && ["active", "trialing"].includes(sub.status)) {
          // Update the existing subscription to the new plan — no new Checkout needed.
          const priceId = await ensurePrice(stripe, planId as PlanId);
          await (stripe.subscriptions.update as any)(user.subscriptionId, {
            items: [{ id: sub.items.data[0].id, price: priceId }],
            proration_behavior: "create_prorations",
            metadata: { clerkUserId, planId },
          });
          // Sync plan to DB immediately; webhook will re-sync when it arrives.
          await db
            .update(users)
            .set({ subscriptionPlanId: planId, updatedAt: new Date() })
            .where(eq(users.clerkId, clerkUserId));
          res.json({ updated: true, url: `${returnBase}/seller/subscription/return?status=success&plan=${planId}` });
          return;
        }
      } catch (retrieveErr: any) {
        // Subscription no longer exists in Stripe — fall through to new Checkout.
        console.warn("Could not retrieve existing subscription:", retrieveErr?.message);
      }
    }

    // No active subscription — create a new Checkout session.
    const [priceId, customerId] = await Promise.all([
      ensurePrice(stripe, planId as PlanId),
      ensureCustomer(stripe, clerkUserId),
    ]);

    const session = await stripe.checkout.sessions.create({
      mode:                      "subscription",
      customer:                  customerId,
      line_items:                [{ price: priceId, quantity: 1 }],
      // Require card upfront even during trial — auto-converts on day 6.
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: 5,
        metadata:          { clerkUserId, planId },
      },
      success_url:          `${returnBase}/seller/subscription/return?status=success&plan=${planId}`,
      cancel_url:           `${returnBase}/seller/subscription/return?status=cancel`,
      client_reference_id:  clerkUserId,
      metadata:             { clerkUserId, planId },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    console.error(err);
    res.status(500).json({ error: "Failed to create subscription checkout" });
  }
});

/**
 * POST /api/seller/subscription/portal
 * Creates a Stripe Billing Portal session so the seller can manage their
 * payment method, view invoices, and cancel their subscription.
 * Returns { url }.
 */
router.post("/portal", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);

    if (!user?.stripeCustomerId) {
      res.status(400).json({ error: "No billing account found. Subscribe to a plan first." });
      return;
    }

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    const returnUrl = `https://${devDomain}/api-server/seller/subscription/portal/return`;

    const session = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    console.error(err);
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

// ─── Post-Stripe redirect landing pages (plain HTML, no auth) ─────────────────

router.use(
  "/return",
  (req: any, res: any, next: any) => {
    // These are Stripe redirects — no Clerk token, skip auth middleware
    (router as any)._requireAuthSkipped = true;
    next();
  },
);

router.get("/return", (req, res) => {
  const status = (req.query.status as string) ?? "success";
  const plan   = (req.query.plan   as string) ?? "";
  const title  = status === "success" ? "✓ Trial started" : "Checkout cancelled";
  const body   = status === "success"
    ? `Your <strong>${plan}</strong> plan trial is now active. You won't be charged until your 5-day trial ends. Close this window and return to the app.`
    : "Your checkout was cancelled. Close this window and return to the app.";

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brandthread</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:60px 24px;background:#07070F;color:#F0EEFF;}
  h1{font-size:1.8rem;margin-bottom:12px;}p{color:#A0A0B8;font-size:1rem;line-height:1.6;}</style></head>
  <body><h1>${title}</h1><p>${body}</p></body></html>`);
});

router.get("/portal/return", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brandthread</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:60px 24px;background:#07070F;color:#F0EEFF;}
  h1{font-size:1.8rem;margin-bottom:12px;}p{color:#A0A0B8;font-size:1rem;}</style></head>
  <body><h1>Billing updated</h1><p>Your billing changes have been saved. Close this window and return to the app.</p></body></html>`);
});

export default router;

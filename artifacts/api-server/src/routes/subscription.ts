/**
 * Seller subscription / platform billing endpoints.
 * Mounted at /api/seller/subscription — all routes require Clerk auth.
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
  growth: { amountCents: 2900, name: "Brandthread Growth Plan", lookupKey: "brandthread_growth_monthly" },
  pro:    { amountCents: 7900, name: "Brandthread Pro Plan",    lookupKey: "brandthread_pro_monthly"    },
} as const;

type PlanId = keyof typeof PLAN_CATALOGUE;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find or create a Stripe Price for the given plan using lookup_key so the
 * same price is reused across calls and deployments.
 */
async function ensurePrice(stripe: any, planId: PlanId): Promise<string> {
  const cfg = PLAN_CATALOGUE[planId];
  const existing = await stripe.prices.list({ lookup_keys: [cfg.lookupKey], limit: 1 });
  if (existing.data.length > 0) return existing.data[0].id;

  const price = await stripe.prices.create({
    currency:      "usd",
    unit_amount:   cfg.amountCents,
    recurring:     { interval: "month" },
    product_data:  { name: cfg.name },
    lookup_key:    cfg.lookupKey,
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
 * Returns the seller's current plan, subscription status, renewal date, and
 * payment method label. If no subscription exists, returns starter/none.
 */
router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({
        subscriptionId:      users.subscriptionId,
        subscriptionStatus:  users.subscriptionStatus,
        subscriptionPeriodEnd: users.subscriptionPeriodEnd,
        subscriptionPlanId:  users.subscriptionPlanId,
        stripeCustomerId:    users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.subscriptionId) {
      res.json({ plan: "starter", status: "none", renewsOn: null, amountCents: 0, paymentMethodLabel: null });
      return;
    }

    // Fetch live status directly from Stripe for accuracy.
    // Cast to `any` because the Stripe SDK's Response<Subscription> generic
    // doesn't expose expanded fields like default_payment_method at the type level.
    const sub: any = await stripe.subscriptions.retrieve(user.subscriptionId, {
      expand: ["default_payment_method"],
    });

    const planId = (user.subscriptionPlanId ?? "starter") as string;
    const planCfg = PLAN_CATALOGUE[planId as PlanId];

    const renewsOn = sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        })
      : null;

    let paymentMethodLabel: string | null = null;
    const pm = sub.default_payment_method as any;
    if (pm?.card) {
      const brand = (pm.card.brand as string).charAt(0).toUpperCase() + pm.card.brand.slice(1);
      paymentMethodLabel = `${brand} ···${pm.card.last4}`;
    }

    res.json({
      plan:               planId,
      status:             sub.status, // active | trialing | past_due | canceled | …
      renewsOn,
      amountCents:        planCfg?.amountCents ?? 0,
      paymentMethodLabel,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    console.error(err);
    res.status(500).json({ error: "Failed to retrieve subscription status" });
  }
});

/**
 * POST /api/seller/subscription/checkout
 * Body: { planId: 'growth' | 'pro' }
 * Creates a Stripe Checkout Session in subscription mode charged to the seller's
 * own payment method. Returns { url } for the mobile client to open.
 */
router.post("/checkout", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const { planId } = req.body;

    if (!planId || !(planId in PLAN_CATALOGUE)) {
      res.status(400).json({ error: "planId must be 'growth' or 'pro'" });
      return;
    }

    const [priceId, customerId] = await Promise.all([
      ensurePrice(stripe, planId as PlanId),
      ensureCustomer(stripe, clerkUserId),
    ]);

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    const returnBase = `https://${devDomain}/api-server`;

    const session = await stripe.checkout.sessions.create({
      mode:               "subscription",
      customer:           customerId,
      line_items:         [{ price: priceId, quantity: 1 }],
      success_url:        `${returnBase}/seller/subscription/return?status=success&plan=${planId}`,
      cancel_url:         `${returnBase}/seller/subscription/return?status=cancel`,
      client_reference_id: clerkUserId,
      metadata:           { clerkUserId, planId },
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
      customer:    user.stripeCustomerId,
      return_url:  returnUrl,
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
  const title  = status === "success" ? "✓ Subscription activated" : "Checkout cancelled";
  const body   = status === "success"
    ? `Your <strong>${plan}</strong> plan is now active. Close this window and return to the app.`
    : "Your checkout was cancelled. Close this window and return to the app.";

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brandthread</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:60px 24px;background:#07070F;color:#F0EEFF;}
  h1{font-size:1.8rem;margin-bottom:12px;}p{color:#A0A0B8;font-size:1rem;}</style></head>
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

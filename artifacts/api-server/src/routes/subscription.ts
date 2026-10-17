/**
 * Seller subscription / platform billing endpoints.
 * Mounted at /api/seller/subscription — all routes require Clerk auth.
 *
 * Three tiers (Starter / Growth / Pro). Prices, the active-product cap,
 * staff seats and every other tier gate live in lib/planCatalogue.ts, the one
 * plan config (served to the app at GET /api/config/seller-plans).
 *
 * Every subscription starts with a TRIAL_DAYS-day free trial (7 by default).
 * The card is collected up front, so the trial converts to paid when it ends
 * unless the seller cancels first.
 *
 * These charges go directly to the seller's own payment method via a standard
 * Stripe Subscription. They are completely separate from Stripe Connect, which
 * handles buyer → seller payment-splitting. Buyers are never touched here.
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { resolveWebAnnualPriceForCheckout } from "../lib/webAnnualPrices";
import { getWebOrigin } from "../lib/webOrigin";
import { intervalFromSubscription, parseBillingInterval, planAmountCents, priceSpecFor, type BillingInterval } from "../lib/billing/annual";
import { dunningAwareStatus, needsPaymentUpdate } from "../lib/billing/dunning";
import { loadDunningSummary } from "../lib/billing/dunningWebhooks";
import { getEffectiveEntitlement, reconcileRevenueCatEntitlement } from "../lib/nativeEntitlements";
import { PLAN_CATALOGUE, TRIAL_DAYS, isSellerPlanId, type SellerPlanId as PlanId } from "../lib/planCatalogue";
import { buildPlanPerks, hasAdvancedAnalytics } from "../lib/planPerks";
import { buildTrialReminderMessage, isDayFourOfFive } from "../jobs/sellerTrialReminder";
import { cancellationDetailsFor, isCancelReasonId } from "../lib/cancelReasons";
import { personHadTrial } from "../lib/personTrial";
import { syncProductsToPlanSoon } from "../lib/planProductSync";
import {
  installIdFrom, isTrialEligible, manageUrlFor, nativeSubscriptionDetails, recordNativeTrialClaim,
} from "../lib/sellerTrial";

const router = Router();

/**
 * Unauthenticated Stripe redirect targets (Checkout success/cancel and the
 * Billing Portal "return" button). A browser lands here with no app session,
 * so these are mounted in routes/index.ts ahead of the authenticated router.
 */
export const subscriptionRedirectRouter = Router();

router.use(requireAuth);
router.use(teamContext());

// ─── Plan catalogue (server-side source of truth) ─────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find or create a Stripe Price for the given plan + billing interval using lookup_key so the
 * same price is reused across calls and deployments.
 *
 * IMPORTANT: if the catalogue price for a plan changes (e.g. Growth $29 → $79)
 * the existing Stripe Price has the old amount. We detect this by comparing
 * unit_amount and create a new Price with transfer_lookup_key:true so that:
 *  - the lookup key moves to the new correct-amount price
 *  - future calls find the right price
 *  - legacy subscribers keep their old price ID until their subscription is updated
 */
async function ensurePlanPrice(stripe: any, planId: PlanId, interval: BillingInterval = "month"): Promise<string> {
  // Monthly or annual (lib/billing/annual.ts: 10 × monthly, "2 months free").
  const cfg = priceSpecFor(planId, interval);
  const existing = await stripe.prices.list({ lookup_keys: [cfg.lookupKey], limit: 1 });

  if (existing.data.length > 0) {
    const found = existing.data[0];
    // Amount and interval match — safe to reuse
    if (found.unit_amount === cfg.amountCents && (found.recurring?.interval ?? "month") === interval) return found.id;
    // Amount mismatch: catalogue was updated but old Stripe Price still holds the key.
    // Create a corrected price and transfer the lookup_key to it.
    logger.warn(
      { lookupKey: cfg.lookupKey, foundAmountCents: found.unit_amount, expectedAmountCents: cfg.amountCents },
      "Subscription price lookup key has a stale amount; creating corrected price",
    );
  }

  const price = await stripe.prices.create({
    currency:             "usd",
    unit_amount:          cfg.amountCents,
    recurring:            { interval },
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

/** The API is served under /api at the web origin (never /api-server). */
export function subscriptionReturnBase(): string {
  return `${getWebOrigin("https://localhost:3000")}/api`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/seller/subscription/perks
 * What each plan includes (price, platform commission, monthly AI credits,
 * advanced analytics), built from planCatalogue + planPerks + the AI credit
 * allowance, plus the caller's verified plan. Paywall copy reads this so the
 * numbers are never hardcoded in the app. Contains no billing details, so any
 * team member may read it. If the plan cannot be verified, `currentPlan` is
 * null and the catalogue is still returned.
 */
router.get("/perks", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  let currentPlan: string | null = null;
  try {
    currentPlan = (await getEffectiveEntitlement(ownerId)).planId;
  } catch (err) {
    req.log?.warn({ err }, "Perks: plan lookup failed");
  }
  res.json({
    plans: buildPlanPerks(),
    currentPlan,
    hasAdvancedAnalytics: currentPlan ? hasAdvancedAnalytics(currentPlan) : false,
  });
});

/**
 * GET /api/seller/subscription/status
 * Returns the seller's current plan, subscription status, renewal date,
 * trial end date, and payment method label.
 * If no subscription exists, returns starter/none.
 *
 * Billing data belongs to the store owner. In particular, team-context
 * rewrites must not let a member inspect another store's payment details.
 */
router.get("/status", requireRole("owner"), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({
        subscriptionId:        users.subscriptionId,
        subscriptionStatus:    users.subscriptionStatus,
        subscriptionPeriodEnd: users.subscriptionPeriodEnd,
        subscriptionPlanId:    users.subscriptionPlanId,
        subscriptionTrialStartedAt: users.subscriptionTrialStartedAt,
        subscriptionTrialEndsAt: users.subscriptionTrialEndsAt,
        trialBannerDismissedTrialEnd: users.subscriptionTrialBannerDismissedTrialEnd,
        stripeCustomerId:      users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const effective = await getEffectiveEntitlement(clerkUserId);
    // Whether checkout would include the free trial (one per person, device and card).
    const trialEligible = await isTrialEligible({ clerkId: clerkUserId, installId: installIdFrom(req) });
    const nativeMetadata = effective.native ? {
      status: effective.native.status,
      productIdentifier: effective.native.productIdentifier,
      expiresAt: effective.native.expiresAt,
      trialEndsAt: effective.native.trialEndsAt,
      isSandbox: effective.native.isSandbox,
      lastSyncedAt: effective.native.lastSyncedAt,
    } : null;

    if (!user.subscriptionId || effective.provider === "revenuecat") {
      const plan = effective.provider === "revenuecat" ? effective.planId : "starter";
      const native = effective.provider === "revenuecat" ? nativeSubscriptionDetails(effective.native) : null;
      res.json({
        plan, status: effective.provider === "revenuecat" ? effective.status : "none",
        renewsOn: null, trialEnd: null,
        trialStartAt: user.subscriptionTrialStartedAt?.toISOString() ?? null,
        trialEndAt: user.subscriptionTrialEndsAt?.toISOString() ?? null,
        trialBanner: null,
        amountCents: effective.provider === "revenuecat" ? PLAN_CATALOGUE[plan].amountCents : 0,
        paymentMethodLabel: null,
        effectiveProvider: effective.provider,
        // The plan the server actually honours for paid tools right now
        // (requirePlan reads the same getEffectiveEntitlement).
        entitledPlan: effective.planId,
        native: nativeMetadata,
        // Cancelling an in-app subscription happens in the store (manageUrl).
        cancelAtPeriodEnd: native?.willRenew === false,
        accessEndsAt: native?.willRenew === false ? effective.native?.expiresAt?.toISOString() ?? null : null,
        manageUrl: native ? manageUrlFor("revenuecat", native) : null,
        trialEligible,
      });
      return;
    }

    const stripe = requireStripe();
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
    const trialStartAt = sub.trial_start
      ? new Date(sub.trial_start * 1000)
      : user.subscriptionTrialStartedAt;
    const trialEndsAt = trialEnd ?? user.subscriptionTrialEndsAt;
    const planId = user.subscriptionPlanId ?? "starter";
    const isDayFour = sub.status === "trialing" && trialStartAt && trialEndsAt
      ? isDayFourOfFive(trialStartAt, trialEndsAt, new Date())
      : false;
    const trialBanner = isDayFour && sub.cancel_at_period_end !== true && user.trialBannerDismissedTrialEnd !== trialEndsAt!.toISOString()
      ? {
          visible: true,
          day: 4,
          daysRemaining: Math.max(0, Math.ceil((trialEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
          trialEndsAt: trialEndsAt!.toISOString(),
          // Same words as the push / email reminder: what is charged and when.
          message: buildTrialReminderMessage({ plan: planId, trialEndsAt: trialEndsAt! }).body,
          cta: "Manage subscription",
        }
      : null;

    const interval = intervalFromSubscription(sub);
    const amountCents = PLAN_CATALOGUE[planId as PlanId] ? planAmountCents(planId as PlanId, interval) : 0;
    // Retry N of 3 / paused-after-failed-payments (lib/billing/dunning.ts).
    const dunning = await loadDunningSummary(clerkUserId, sub.status).catch(() => null);

    // Payment method label — card brand + last4
    const pm  = sub.default_payment_method;
    const pmLabel = pm?.card
      ? `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} ···· ${pm.card.last4}`
      : pm?.type
        ? pm.type
        : null;

    res.json({
      plan:               planId,
      status:             dunningAwareStatus(sub),
      renewsOn,
      trialEnd:           trialEndFmt,
      trialStartAt:       trialStartAt?.toISOString() ?? null,
      trialEndAt:         trialEndsAt?.toISOString() ?? null,
      trialBanner,
      amountCents,
      interval,
      dunning,
      paymentMethodLabel: pmLabel,
      // Reaching this branch means the persisted Stripe subscription was
      // retrieved successfully. Keep billing recovery pointed at Stripe even
      // when an unpaid subscription no longer grants an effective entitlement.
      effectiveProvider: "stripe",
      // `plan` is what the seller is BILLED for; an unpaid/incomplete
      // subscription keeps it but grants nothing. Tools unlock on this.
      entitledPlan: effective.planId,
      native: nativeMetadata,
      // Cancelled (Settings → Plan → Cancel plan, or the Stripe portal): access
      // runs to accessEndsAt and nothing more is charged.
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      accessEndsAt: sub.cancel_at_period_end === true
        ? (sub.status === "trialing" && trialEnd ? trialEnd : periodEnd)?.toISOString() ?? null
        : null,
      manageUrl: manageUrlFor("stripe"),
      trialEligible,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    req.log.error({ err }, "Failed to fetch subscription status");
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

/**
 * GET /api/seller/subscription/entitlement
 * The store's effective plan for unlocking tools — no billing details — so
 * every member of the store (not just the owner, who alone may see /status)
 * sees the same locks the server enforces through requirePlan, which already
 * checks the STORE OWNER's plan for team members.
 */
router.get("/entitlement", requireRole("viewer"), async (req, res) => {
  const storeOwnerId = (req as any).clerkUserId as string;
  const effective = await getEffectiveEntitlement(storeOwnerId);
  res.json({ plan: effective.planId, status: effective.status, provider: effective.provider });
});

/** Persist dismissal for this exact trial only; a future trial shows again. */
router.post("/trial-banner/dismiss", requireRole("owner"), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const [user] = await db.select({
      trialEndsAt: users.subscriptionTrialEndsAt,
    }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    const serverTrialEndAt = user?.trialEndsAt?.toISOString();
    const requestedTrialEndAt = typeof req.body?.trialEndAt === "string"
      ? req.body.trialEndAt
      : serverTrialEndAt;
    if (!serverTrialEndAt || requestedTrialEndAt !== serverTrialEndAt) {
      res.status(400).json({ error: "A valid trialEndAt is required" });
      return;
    }
    const [window] = await db.select({
      trialStartedAt: users.subscriptionTrialStartedAt,
      status: users.subscriptionStatus,
    }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    if (
      window?.status !== "trialing" ||
      !window.trialStartedAt ||
      !isDayFourOfFive(window.trialStartedAt, new Date(serverTrialEndAt), new Date())
    ) {
      res.status(400).json({ error: "Trial reminder is only available on day four" });
      return;
    }
    await db.update(users).set({
      subscriptionTrialBannerDismissedTrialEnd: serverTrialEndAt,
      updatedAt: new Date(),
    }).where(eq(users.clerkId, clerkUserId));
    res.json({ ok: true, trialEndAt: serverTrialEndAt });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss trial banner");
    res.status(500).json({ error: "Failed to dismiss trial banner" });
  }
});

/** Reconciles the authenticated owner's native-store entitlement from RevenueCat. */
router.post("/native/sync", requireRole("owner"), async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const entitlement = await reconcileRevenueCatEntitlement(clerkUserId);
    const effective = await getEffectiveEntitlement(clerkUserId);
    syncProductsToPlanSoon(clerkUserId);
    await recordNativeTrialClaim(clerkUserId, entitlement, installIdFrom(req)).catch((err) => {
      req.log.warn({ err }, "Could not record the native trial claim");
    });
    res.json({
      plan: effective.planId,
      status: effective.status,
      effectiveProvider: effective.provider,
      native: {
        ...entitlement,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        trialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "Native subscription reconciliation failed");
    res.status(503).json({ error: "Unable to reconcile native subscription" });
  }
});

/**
 * GET /api/seller/subscription/invoices
 * Returns a minimal invoice history for the store owner. Invoice and payment
 * details must never be exposed through a joined-store team context.
 */
router.get("/invoices", requireRole("owner"), async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user?.stripeCustomerId) {
      res.json({ invoices: [] });
      return;
    }

    const result = await stripe.invoices.list({ customer: user.stripeCustomerId, limit: 50 });
    res.json({
      invoices: result.data.map((invoice) => ({
        id:          invoice.id,
        created:     new Date(invoice.created * 1000).toISOString(),
        description: invoice.description ?? "Subscription invoice",
        amountCents: invoice.amount_paid || invoice.amount_due,
        currency:    invoice.currency,
        status:      invoice.status === "paid" ? "paid" : "unpaid",
      })),
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to fetch subscription invoice history");
    res.status(500).json({ error: "Failed to fetch invoice history" });
  }
});

/**
 * POST /api/seller/subscription/checkout
 * Body: { planId: 'starter' | 'growth' | 'pro', interval?: 'month' | 'year' }
 *   interval defaults to 'month'; 'year' bills 10 × monthly (2 months free).
 *   Switching interval on an active plan updates in place with prorations.
 *
 * • If the seller already has an active or trialing subscription, updates it
 *   in-place (Stripe subscription items update + prorations) instead of creating
 *   a new Checkout session — this prevents concurrent duplicate subscriptions.
 * • If no active subscription exists, creates a Stripe Checkout Session in
 *   subscription mode with a TRIAL_DAYS-day free trial. The card is collected
 *   up front, so the trial converts to paid when it ends. One trial per person
 *   and device (lib/sellerTrial.ts): otherwise the checkout charges today, and
 *   Stripe's page says so.
 * • Picking a plan while a cancellation is pending re-subscribes (clears
 *   cancel_at_period_end): the one-tap re-subscribe.
 * Returns { url, trial } for redirect or { updated: true } for in-place update.
 */
router.post("/checkout", requireRole("owner"), async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const { planId } = req.body;

    if (!isSellerPlanId(planId)) {
      res.status(400).json({ error: "planId must be 'starter', 'growth', or 'pro'" });
      return;
    }
    const interval = parseBillingInterval(req.body?.interval);
    if (!interval) {
      res.status(400).json({ error: "interval must be 'month' or 'year'" });
      return;
    }
    // Every price lookup in this handler uses the requested billing interval.
    const ensurePrice = (client: any, plan: PlanId) => ensurePlanPrice(client, plan, interval);

    // Optional { billing: "annual" }: the web-only yearly Stripe price
    // (STRIPE_PRICE_<TIER>_ANNUAL_WEB, lib/webAnnualPrices.ts). Monthly otherwise.
    const annualPriceId = req.body?.billing === "annual"
      ? await resolveWebAnnualPriceForCheckout(stripe as any, planId)
      : null;
    if (req.body?.billing === "annual" && !annualPriceId) {
      res.status(400).json({ error: "Yearly billing isn't available for this plan." });
      return;
    }

    const returnBase = subscriptionReturnBase();

    // Check for an existing active or trialing subscription so we don't create a duplicate.
    const [user] = await db
      .select({ subscriptionId: users.subscriptionId })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);

    if (user?.subscriptionId) {
      try {
        const sub = await (stripe.subscriptions.retrieve as any)(user.subscriptionId);
        // An unpaid plan is recovered by paying it (Update card → portal),
        // never by a second subscription (item 115).
        if (sub && needsPaymentUpdate(sub)) {
          res.status(409).json({
            error: "Payment update required",
            code: "SUBSCRIPTION_NEEDS_PAYMENT_UPDATE",
            message: "Update your card to restore your plan.",
          });
          return;
        }
        if (sub && ["active", "trialing"].includes(sub.status)) {
          // Update the existing subscription to the new plan — no new Checkout needed.
          const priceId = annualPriceId ?? await ensurePrice(stripe, planId);
          await (stripe.subscriptions.update as any)(user.subscriptionId, {
            items: [{ id: sub.items.data[0].id, price: priceId }],
            proration_behavior: "create_prorations",
            cancel_at_period_end: false,
            metadata: { clerkUserId, planId },
          });
          // Sync plan to DB immediately; webhook will re-sync when it arrives.
          await db
            .update(users)
            .set({ subscriptionPlanId: planId, subscriptionCancelAtPeriodEnd: false, updatedAt: new Date() })
            .where(eq(users.clerkId, clerkUserId));
          res.json({ updated: true, url: `${returnBase}/seller/subscription/return?status=success&plan=${planId}` });
          return;
        }
      } catch (retrieveErr: any) {
        // Subscription no longer exists in Stripe — fall through to new Checkout.
        req.log.warn({ err: retrieveErr, subscriptionId: user.subscriptionId }, "Could not retrieve existing subscription");
      }
    }

    // No active subscription — create a new Checkout session.
    const installId = installIdFrom(req);
    const [priceId, customerId, eligible] = await Promise.all([
      annualPriceId ?? ensurePrice(stripe, planId),
      ensureCustomer(stripe, clerkUserId),
      isTrialEligible({ clerkId: clerkUserId, installId }),
    ]);

    // One free trial per person: a login's other profile (or a deleted one)
    // that already had a trial means this checkout starts paid.
    const trial = eligible && !(await personHadTrial(clerkUserId));
    const session = await stripe.checkout.sessions.create({
      mode:                      "subscription",
      customer:                  customerId,
      line_items:                [{ price: priceId, quantity: 1 }],
      // Require card upfront even during trial; it converts automatically when
      // the trial (TRIAL_DAYS, lib/planCatalogue.ts) ends unless cancelled.
      payment_method_collection: "always",
      subscription_data: {
        ...(trial ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata:          { clerkUserId, planId, ...(installId ? { installId } : {}) },
      },
      success_url:          `${returnBase}/seller/subscription/return?status=success&plan=${planId}${trial ? "" : "&trial=0"}`,
      cancel_url:           `${returnBase}/seller/subscription/return?status=cancel`,
      client_reference_id:  clerkUserId,
      metadata:             { clerkUserId, planId },
    });

    res.json({ url: session.url, trial });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    req.log.error({ err }, "Failed to create subscription checkout");
    res.status(500).json({ error: "Failed to create subscription checkout" });
  }
});

/**
 * POST /api/seller/subscription/cancel   — cancel at the end of the paid period
 * POST /api/seller/subscription/resume   — undo a pending cancellation
 * Stripe subscriptions only: App Store / Play subscriptions are cancelled in
 * the store, so those answer 409 with code MANAGE_IN_STORE and a manage URL.
 */
async function setCancelAtPeriodEnd(req: any, res: any, cancel: boolean): Promise<void> {
  try {
    const clerkUserId = req.clerkUserId as string;
    const effective = await getEffectiveEntitlement(clerkUserId);
    if (effective.provider === "revenuecat") {
      res.status(409).json({
        error: "This plan is billed through the App Store or Google Play. Manage it in your store subscriptions.",
        code: "MANAGE_IN_STORE",
        manageUrl: manageUrlFor("revenuecat", nativeSubscriptionDetails(effective.native)),
      });
      return;
    }
    const [user] = await db
      .select({ subscriptionId: users.subscriptionId })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    if (!user?.subscriptionId) {
      res.status(409).json({ error: "You don't have a paid plan to change.", code: cancel ? "NO_SUBSCRIPTION" : "RESUBSCRIBE_REQUIRED" });
      return;
    }
    const stripe = requireStripe();
    const sub = await (stripe.subscriptions.retrieve as any)(user.subscriptionId);
    if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) {
      res.status(409).json({ error: "This subscription has already ended.", code: cancel ? "SUBSCRIPTION_ENDED" : "RESUBSCRIBE_REQUIRED" });
      return;
    }
    // Optional "main reason" from the in-app cancel flow → Stripe's own
    // cancellation feedback. Unknown reasons are ignored, never an error.
    const details = cancel ? cancellationDetailsFor(req.body?.reason, req.body?.comment) : null;
    const updated = sub.cancel_at_period_end === cancel
      ? sub
      : await (stripe.subscriptions.update as any)(user.subscriptionId, {
          cancel_at_period_end: cancel,
          ...(details ? { cancellation_details: details } : {}),
          metadata: {
            ...(sub.metadata ?? {}),
            clerkUserId,
            cancelledInApp: cancel ? "true" : "false",
            cancelReason: cancel && isCancelReasonId(req.body?.reason) ? req.body.reason : "",
          },
        });
    await db.update(users).set({ subscriptionCancelAtPeriodEnd: cancel, updatedAt: new Date() })
      .where(eq(users.clerkId, clerkUserId));
    const inTrial = updated.status === "trialing";
    const endUnix = inTrial && updated.trial_end ? updated.trial_end : updated.current_period_end;
    const periodEnd = typeof endUnix === "number" ? new Date(endUnix * 1000) : null;
    req.log?.info?.({ clerkUserId, cancel }, "Seller subscription cancel_at_period_end changed");
    res.json({
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end === true,
      endsAt: cancel && periodEnd ? periodEnd.toISOString() : null,
      inTrial,
      accessEndsAt: cancel && periodEnd ? periodEnd.toISOString() : null,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    req.log.error({ err }, cancel ? "Failed to cancel subscription" : "Failed to resume subscription");
    res.status(500).json({ error: cancel ? "Failed to cancel subscription" : "Failed to resume subscription" });
  }
}

router.post("/cancel", requireRole("owner"), (req, res) => setCancelAtPeriodEnd(req, res, true));
router.post("/resume", requireRole("owner"), (req, res) => setCancelAtPeriodEnd(req, res, false));

/**
 * POST /api/seller/subscription/portal
 * Creates a Stripe Billing Portal session so the seller can manage their
 * payment method, view invoices, and cancel their subscription.
 * Returns { url }.
 */
router.post("/portal", requireRole("owner"), async (req, res) => {
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

    const returnUrl = `${subscriptionReturnBase()}/seller/subscription/portal/return`;

    const session = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) { res.status(status).json({ error: err.message }); return; }
    req.log.error({ err }, "Failed to create billing portal session");
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

// ─── Post-Stripe redirect landing pages (plain HTML, no auth) ─────────────────

const APP_SUBSCRIPTION_DEEP_LINK = "brandthread://subscription";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function landingPage(title: string, body: string, deepLink: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brandthread</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:60px 24px;background:#000;color:#fff;}
  h1{font-size:1.8rem;margin-bottom:12px;}p{color:#C0C0C0;font-size:1rem;line-height:1.6;}
  a{display:inline-block;margin-top:20px;padding:12px 22px;border-radius:999px;background:#fff;color:#000;text-decoration:none;font-weight:600;}</style></head>
  <body><h1>${title}</h1><p>${body}</p><a href="${deepLink}">Return to Brandthread</a></body></html>`;
}

subscriptionRedirectRouter.get("/return", (req, res) => {
  const status = req.query.status === "cancel" ? "cancel" : "success";
  const plan = isSellerPlanId(req.query.plan) ? PLAN_CATALOGUE[req.query.plan].name : "";
  const title = status === "success" ? "✓ Subscription started" : "Checkout cancelled";
  const body = status === "success"
    ? `Your ${plan ? `<strong>${escapeHtml(plan)}</strong>` : "plan"} is now active. If your plan includes a free trial you won't be charged until it ends. Return to the app to continue.`
    : "Your checkout was cancelled and you have not been charged. Return to the app to continue.";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(landingPage(title, body, `${APP_SUBSCRIPTION_DEEP_LINK}?checkout=${status}`));
});

subscriptionRedirectRouter.get("/portal/return", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(landingPage(
    "Billing updated",
    "Your billing changes have been saved. Return to the app to continue.",
    `${APP_SUBSCRIPTION_DEEP_LINK}?portal=returned`,
  ));
});

export default router;

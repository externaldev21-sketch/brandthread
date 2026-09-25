/**
 * Stripe Connect endpoints for seller onboarding and payout management.
 * Mounted at /api/seller/connect — all routes require Clerk auth.
 */
import { Router } from "express";
import type Stripe from "stripe";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, stripe } from "../lib/stripe";
import { getWebOrigin } from "../lib/webOrigin";

const router = Router();

/**
 * Best-effort read of the tax info the account still needs, from the same
 * `requirements` block Stripe already returns on account retrieval — no new
 * business logic, just surfacing an existing field for the setup screen.
 */
function deriveTaxInfoStatus(account: Stripe.Account): "submitted" | "needed" | "unknown" {
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.eventually_due ?? []),
  ];
  const needsTaxInfo = due.some((field) => /tax_id|id_number|ssn_last_4/.test(field));
  if (needsTaxInfo) return "needed";
  if (account.details_submitted) return "submitted";
  return "unknown";
}

function payoutScheduleOf(account: Stripe.Account) {
  const schedule = account.settings?.payouts?.schedule;
  if (!schedule) return null;
  return {
    interval: schedule.interval ?? null,
    delayDays: schedule.delay_days ?? null,
    weeklyAnchor: schedule.weekly_anchor ?? null,
    monthlyAnchor: schedule.monthly_anchor ?? null,
  };
}
router.use(requireAuth);

/**
 * POST /api/seller/connect/onboard
 * Initiates Stripe Connect Express onboarding for the authenticated seller.
 * Creates a Connect account if one doesn't exist yet, then returns an account link URL.
 * Body (optional): { refreshUrl, returnUrl }
 */
router.post("/onboard", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const baseUrl = `${getWebOrigin("https://localhost:3000")}/api-server`;
    const {
      refreshUrl = `${baseUrl}/seller/connect/onboard/refresh`,
      returnUrl = `${baseUrl}/seller/connect/onboard/return`,
    } = req.body;

    // Load or create seller user record
    const [user] = await db
      .select({ id: users.id, stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }

    let stripeAccountId = user.stripeAccountId;

    // Create a new Connect Express account if needed
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({ type: "express" });
      stripeAccountId = account.id;
      await db
        .update(users)
        .set({ stripeAccountId, stripeAccountStatus: "pending", updatedAt: new Date() })
        .where(eq(users.clerkId, clerkUserId));
    }

    // Create an account link for the onboarding flow
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url, stripeAccountId });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err }, "Failed to create Connect onboarding link");
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  }
});

/**
 * GET /api/seller/connect/status
 * Returns the seller's Stripe Connect account status.
 */
router.get("/status", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId, stripeAccountStatus: users.stripeAccountStatus })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Never let a missing/misconfigured Stripe key crash this endpoint — the
    // mobile Payouts screen needs a clean "setup needed" state to render
    // instead of a 500/503.
    const providerConfigured = Boolean(stripe);

    if (!user.stripeAccountId) {
      res.json({
        connected: false,
        stripeAccountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        status: "not_started",
        verified: false,
        bankLast4: null,
        providerConfigured,
        payoutSchedule: null,
        requirementsDue: [],
        taxInfoStatus: "unknown" as const,
      });
      return;
    }

    if (!providerConfigured) {
      // The account exists on our side but this environment has no Stripe
      // key configured — surface that plainly rather than throwing.
      res.json({
        connected: true,
        stripeAccountId: user.stripeAccountId,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        status: "provider_unavailable",
        verified: false,
        bankLast4: null,
        providerConfigured: false,
        payoutSchedule: null,
        requirementsDue: [],
        taxInfoStatus: "unknown" as const,
      });
      return;
    }

    const stripeClient = requireStripe();
    // Fetch the live account and only the external-account data needed to
    // identify the payout bank. Never return Stripe's account object itself.
    const account = await stripeClient.accounts.retrieve(user.stripeAccountId);
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;
    // A seller cannot receive payouts until Stripe has enabled payouts. Keep
    // this deliberately simple so an incomplete account never looks active.
    const stripeAccountStatus =
      chargesEnabled && payoutsEnabled
        ? "active"
        : detailsSubmitted
          ? "restricted"
          : "pending";
    const bankAccounts = [];
    let startingAfter: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await stripeClient.accounts.listExternalAccounts(
        user.stripeAccountId,
        { object: "bank_account", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      );
      bankAccounts.push(...page.data);
      hasMore = page.has_more && page.data.length > 0;
      startingAfter = hasMore ? page.data[page.data.length - 1]?.id : undefined;
    }
    const defaultCurrency = account.default_currency?.toLowerCase();
    const bankAccount =
      bankAccounts.find((externalAccount) =>
        externalAccount.object === "bank_account"
        && externalAccount.default_for_currency === true
        && (!defaultCurrency || externalAccount.currency.toLowerCase() === defaultCurrency)
      )
      ?? bankAccounts.find((externalAccount) =>
        externalAccount.object === "bank_account"
        && externalAccount.default_for_currency === true
      )
      ?? (bankAccounts.length === 1 ? bankAccounts[0] : undefined);
    const bankLast4 = bankAccount?.object === "bank_account"
      ? bankAccount.last4 ?? null
      : null;

    if (stripeAccountStatus !== user.stripeAccountStatus) {
      await db
        .update(users)
        .set({ stripeAccountStatus, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkUserId));
    }

    res.json({
      connected: true,
      stripeAccountId: user.stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      status: stripeAccountStatus,
       verified: payoutsEnabled,
      bankLast4,
      providerConfigured: true,
      payoutSchedule: payoutScheduleOf(account),
      requirementsDue: account.requirements?.currently_due ?? [],
      taxInfoStatus: deriveTaxInfoStatus(account),
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err }, "Failed to retrieve Connect status");
      res.status(500).json({ error: "Failed to retrieve Connect status" });
    }
  }
});

/**
 * GET /api/seller/connect/onboard/return
 * Landing page after Stripe redirects the seller back post-onboarding.
 */
router.get("/onboard/return", (_req, res) => {
  res.json({ message: "Stripe Connect onboarding complete. You can close this window." });
});

/**
 * GET /api/seller/connect/onboard/refresh
 * Stripe redirects here if the account link expires — caller should re-call /onboard.
 */
router.get("/onboard/refresh", (_req, res) => {
  res.json({ message: "Onboarding link expired. Please restart the onboarding flow." });
});

export default router;

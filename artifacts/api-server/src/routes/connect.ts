/**
 * Stripe Connect endpoints for seller onboarding and payout management.
 * Mounted at /api/seller/connect — all routes require Clerk auth, except the
 * Stripe redirect targets exported as `connectRedirectRouter`.
 */
import { Router } from "express";
import type Stripe from "stripe";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, stripe } from "../lib/stripe";
import { allowedWebOrigins, getWebOrigin } from "../lib/webOrigin";
import {
  APP_REFRESH_DEEP_LINK,
  APP_RETURN_DEEP_LINK,
  allowListedRedirect,
  buildConnectSteps,
  deadlineIso,
  deriveSetupState,
  selectHostedLink,
  signConnectState,
  verifyConnectState,
} from "../lib/connectOnboarding";

const router = Router();

/**
 * Unauthenticated Stripe redirect targets (a browser lands here with no app
 * session). Mounted separately in routes/index.ts, before the authenticated
 * /seller/connect router.
 */
export const connectRedirectRouter = Router();

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

// ── Hosted-link helpers ──────────────────────────────────────────────────────

type ConnectUrls = { refreshUrl: string; returnUrl: string };

function stateSecret(): string | null {
  return process.env.CONNECT_STATE_SECRET || process.env.STRIPE_SECRET_KEY || null;
}

function defaultUrls(clerkUserId: string): ConnectUrls {
  const base = `${getWebOrigin("https://localhost:3000")}/api/seller/connect/onboard`;
  const secret = stateSecret();
  const token = secret ? `?state=${encodeURIComponent(signConnectState(clerkUserId, secret))}` : "";
  return { refreshUrl: `${base}/refresh${token}`, returnUrl: `${base}/return` };
}

/** Reuse the seller's Express account, creating it (once) when missing. */
async function ensureConnectAccount(client: Stripe, clerkUserId: string) {
  const [user] = await db
    .select({
      id: users.id,
      stripeAccountId: users.stripeAccountId,
      email: users.email,
      brandName: users.brandName,
    })
    .from(users)
    .where(eq(users.clerkId, clerkUserId))
    .limit(1);
  if (!user) return null;
  if (user.stripeAccountId) return { stripeAccountId: user.stripeAccountId, created: false };

  // Stripe hosts identity, bank, W-9 tax info and the ToS acceptance; we only
  // pre-declare capabilities and non-sensitive defaults. The idempotency key
  // makes concurrent first taps resolve to one account.
  const account = await client.accounts.create(
    {
      type: "express",
      country: "US",
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      ...(user.email ? { email: user.email, individual: { email: user.email } } : {}),
      ...(user.brandName ? { business_profile: { name: user.brandName } } : {}),
      metadata: { clerk_user_id: clerkUserId, platform: "brandthread" },
    },
    { idempotencyKey: `connect-express-${clerkUserId}` },
  );
  await db
    .update(users)
    .set({ stripeAccountId: account.id, stripeAccountStatus: "pending", updatedAt: new Date() })
    .where(eq(users.clerkId, clerkUserId));
  return { stripeAccountId: account.id, created: true };
}

/** Mint a fresh single-use hosted link (onboarding, or Express dashboard once complete). */
async function mintHostedLink(client: Stripe, clerkUserId: string, urls: ConnectUrls) {
  const ensured = await ensureConnectAccount(client, clerkUserId);
  if (!ensured) return null;
  const account = await client.accounts.retrieve(ensured.stripeAccountId);
  const kind = selectHostedLink(account);
  if (kind === "login_link") {
    const login = await client.accounts.createLoginLink(ensured.stripeAccountId);
    return { url: login.url, kind, expiresAt: null as number | null, stripeAccountId: ensured.stripeAccountId };
  }
  const link = await client.accountLinks.create({
    account: ensured.stripeAccountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url, kind, expiresAt: link.expires_at ?? null, stripeAccountId: ensured.stripeAccountId };
}

function sendRouteError(req: any, res: any, err: any, logMessage: string, publicMessage: string) {
  const status = err.status ?? 500;
  if (status < 500) {
    res.status(status).json({ error: err.message });
  } else if (status === 503) {
    res.status(503).json({ error: err.message });
  } else {
    req.log.error({ err }, logMessage);
    res.status(500).json({ error: publicMessage });
  }
}

router.use(requireAuth);

/**
 * POST /api/seller/connect/onboard
 * Initiates (or resumes) Stripe Connect Express onboarding for the seller.
 * Reuses the existing account on every call. Body (optional): { refreshUrl,
 * returnUrl } — only https URLs on Brandthread's own allow-listed origins.
 */
router.post("/onboard", async (req, res) => {
  try {
    const client = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const urls = defaultUrls(clerkUserId);
    const body = (req.body ?? {}) as { refreshUrl?: unknown; returnUrl?: unknown };
    for (const key of ["refreshUrl", "returnUrl"] as const) {
      if (body[key] === undefined) continue;
      const safe = allowListedRedirect(body[key], allowedWebOrigins());
      if (!safe) {
        res.status(400).json({ error: `${key} must be an https URL on a Brandthread origin` });
        return;
      }
      urls[key] = safe;
    }
    const link = await mintHostedLink(client, clerkUserId, urls);
    if (!link) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }
    res.json(link);
  } catch (err: any) {
    sendRouteError(req, res, err, "Failed to create Connect onboarding link", "Failed to create onboarding link");
  }
});

/**
 * GET /api/seller/connect/link  (alias POST /resume)
 * A fresh hosted link for resuming setup. Links are single-use and short
 * lived, so the app asks for a new one each time the seller taps Resume.
 */
async function resumeHandler(req: any, res: any) {
  try {
    const client = requireStripe();
    const clerkUserId = req.clerkUserId as string;
    const link = await mintHostedLink(client, clerkUserId, defaultUrls(clerkUserId));
    if (!link) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }
    res.json(link);
  } catch (err: any) {
    sendRouteError(req, res, err, "Failed to create Connect resume link", "Failed to create onboarding link");
  }
}
router.get("/link", resumeHandler);
router.post("/resume", resumeHandler);

/** Fields added for the setup checklist; identical shape on every status branch. */
function setupFields(account: Stripe.Account | null, hasBankAccount: boolean) {
  const steps = buildConnectSteps(account, { hasBankAccount });
  const req = account?.requirements;
  return {
    setupState: deriveSetupState(account, steps),
    steps,
    deadline: deadlineIso(account),
    disabledReason: req?.disabled_reason ?? null,
    pastDue: req?.past_due ?? [],
    pendingVerification: req?.pending_verification ?? [],
    futureRequirements: [
      ...(account?.future_requirements?.currently_due ?? []),
      ...(account?.future_requirements?.eventually_due ?? []),
    ],
  };
}

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
        ...setupFields(null, false),
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
        ...setupFields(null, false),
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
      ...setupFields(account, bankAccounts.length > 0),
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

/** Stripe sends the seller here when they finish; hand them back to the app. */
connectRedirectRouter.get("/return", (_req, res) => {
  res.redirect(302, APP_RETURN_DEEP_LINK);
});

/**
 * Stripe sends the seller here when the link expired or was already used. A
 * valid signed `state` mints a fresh hosted link and continues the flow;
 * otherwise the seller lands back in the app, which asks for a new link.
 */
connectRedirectRouter.get("/refresh", async (req, res) => {
  try {
    const secret = stateSecret();
    const clerkUserId = secret ? verifyConnectState(req.query.state, secret) : null;
    if (!clerkUserId || !stripe) {
      res.redirect(302, APP_REFRESH_DEEP_LINK);
      return;
    }
    const link = await mintHostedLink(stripe, clerkUserId, defaultUrls(clerkUserId));
    res.redirect(302, link ? link.url : APP_REFRESH_DEEP_LINK);
  } catch (err) {
    (req as any).log?.error({ err }, "Failed to refresh Connect onboarding link");
    res.redirect(302, APP_REFRESH_DEEP_LINK);
  }
});

export default router;

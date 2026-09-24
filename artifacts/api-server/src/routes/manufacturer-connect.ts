/**
 * Stripe Connect Express for manufacturer payouts.
 * Mounted at /api/manufacturers/connect
 * Requires the authenticated user to have a manufacturer profile.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { manufacturerActivityEvents, manufacturers, sampleOrders } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireStripe } from "../lib/stripe";
import { getWebOrigin } from "../lib/webOrigin";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";
import { findCountry } from "@workspace/manufacturer-flow";

const router = Router();

async function resolveManufacturer(clerkId: string) {
  const [mfr] = await db
    .select()
    .from(manufacturers)
    .where(eq(manufacturers.clerkId, clerkId))
    .limit(1);
  return mfr ?? null;
}

export function isAllowedOnboardingUrl(value: unknown): value is string {
  return isAllowedBrandthreadCallbackUrl(value, "manufacturer_onboarding");
}

/** Country the platform's Stripe account is registered in. */
export const PLATFORM_STRIPE_COUNTRY = (process.env.STRIPE_PLATFORM_COUNTRY ?? "US").toUpperCase();

export function connectReadiness(account: {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  capabilities?: { transfers?: string | null; card_payments?: string | null } | null;
  tos_acceptance?: { service_agreement?: string | null } | null;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; disabled_reason?: string | null };
}) {
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  // International manufacturers use Stripe's cross-border "recipient"
  // agreement: they never process charges themselves, they receive the
  // transfer from a destination charge. For them the transfers capability is
  // what must be active.
  const accountType = account.tos_acceptance?.service_agreement === "recipient" ? "recipient" as const : "full" as const;
  const canReceiveFunds = accountType === "recipient"
    ? account.capabilities?.transfers === "active"
    : chargesEnabled;
  const ready = canReceiveFunds && payoutsEnabled && detailsSubmitted;
  const requirementsDue = Array.from(new Set([
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ]));
  return {
    ready,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    status: ready ? "active" : detailsSubmitted ? "restricted" : "pending",
    requirementsDue,
    disabledReason: account.requirements?.disabled_reason ?? null,
    accountType,
  };
}

/** Plain-English onboarding failure for an unsupported or unset country. */
export function connectCountryProblem(country: string | null | undefined): string | null {
  if (!country?.trim()) return "Add your country in Business Profile before setting up payouts.";
  if (!findCountry(country)) {
    return `We don't have payout details for "${country}" yet. Update your country in Business Profile or contact support.`;
  }
  return null;
}

// ── POST /api/manufacturers/connect/onboard ────────────────────────────────────

router.post("/onboard", async (req, res) => {
  try {
    const stripe = requireStripe();
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const baseUrl = getWebOrigin("https://localhost:3000");
    const {
      refreshUrl = `${baseUrl}/manufacturers/payment`,
      returnUrl  = `${baseUrl}/manufacturers/payment`,
    } = req.body;
    if (!isAllowedOnboardingUrl(refreshUrl) || !isAllowedOnboardingUrl(returnUrl)) {
      res.status(400).json({ error: "refreshUrl and returnUrl must be allowed Brandthread app or web URLs" });
      return;
    }

    const mfr = await resolveManufacturer(userId);
    if (!mfr) {
      res.status(404).json({ error: "Manufacturer profile not found — register first" });
      return;
    }

    let stripeAccountId = mfr.stripeAccountId;

    if (!stripeAccountId) {
      const countryProblem = connectCountryProblem(mfr.country);
      if (countryProblem) { res.status(422).json({ error: countryProblem, code: "COUNTRY_REQUIRED" }); return; }
      const country = findCountry(mfr.country)!;
      const recipient = country.code !== PLATFORM_STRIPE_COUNTRY;
      let account;
      try {
        account = await stripe.accounts.create(
          {
            type: "express",
            country: country.code,
            email: mfr.contactEmail ?? undefined,
            business_profile: {
              name: mfr.businessName,
              product_description: `Apparel manufacturing (${mfr.specialty}) for Brandthread sellers`,
              url: mfr.website ?? undefined,
            },
            capabilities: recipient
              ? { transfers: { requested: true } }
              : { card_payments: { requested: true }, transfers: { requested: true } },
            ...(recipient ? { tos_acceptance: { service_agreement: "recipient" as const } } : {}),
            metadata: { manufacturerId: mfr.id },
          },
          { idempotencyKey: `manufacturer-connect-account/${mfr.id}/${country.code}` },
        );
      } catch (error: any) {
        if (error?.type === "StripeInvalidRequestError") {
          req.log.warn({ err: error, country: country.code }, "Stripe rejected manufacturer Connect account");
          res.status(422).json({
            error: `Stripe can't open payout accounts in ${country.name} for this platform yet. Contact support and we'll help you get paid another way.`,
            code: "COUNTRY_NOT_SUPPORTED",
          });
          return;
        }
        throw error;
      }
      stripeAccountId = account.id;
      await db
        .update(manufacturers)
        .set({ stripeAccountId, stripeAccountStatus: "pending", updatedAt: new Date() })
        .where(eq(manufacturers.id, mfr.id));
    }

    const accountLink = await stripe.accountLinks.create({
      account:     stripeAccountId,
      refresh_url: refreshUrl,
      return_url:  returnUrl,
      type:        "account_onboarding",
    });

    res.json({ url: accountLink.url, stripeAccountId });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err, status }, "Failed to create manufacturer Connect onboarding link");
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  }
});

// ── GET /api/manufacturers/connect/status ──────────────────────────────────────

router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const mfr = await resolveManufacturer(userId);
    if (!mfr) {
      res.status(404).json({ error: "Manufacturer profile not found" }); return;
    }

    if (!mfr.stripeAccountId) {
      res.json({
        connected:        false,
        chargesEnabled:   false,
        payoutsEnabled:   false,
        detailsSubmitted: false,
        ready:            false,
        status:           "not_started",
        requirementsDue:  [],
        disabledReason:   null,
        country:          findCountry(mfr.country)?.code ?? null,
        payoutCurrency:   null,
        accountType:      findCountry(mfr.country) && findCountry(mfr.country)!.code !== PLATFORM_STRIPE_COUNTRY ? "recipient" : "full",
        countryProblem:   connectCountryProblem(mfr.country),
        recovery:         "Start Stripe onboarding and add an eligible bank account before accepting payments.",
      });
      return;
    }

    const account = await stripe.accounts.retrieve(mfr.stripeAccountId);
    if (account.deleted) {
      res.status(409).json({ error: "Connected payout account was deleted", connected: false, ready: false });
      return;
    }
    const readiness = connectReadiness(account);
    if (mfr.stripeAccountStatus !== readiness.status || mfr.paymentSetup !== readiness.ready) {
      await db
        .update(manufacturers)
        .set({ stripeAccountStatus: readiness.status, paymentSetup: readiness.ready, updatedAt: new Date() })
        .where(eq(manufacturers.id, mfr.id));
    }

    res.json({
      connected:        true,
      stripeAccountId:  mfr.stripeAccountId,
      country:          account.country ?? null,
      payoutCurrency:   account.default_currency?.toUpperCase() ?? null,
      ...readiness,
      recovery: readiness.ready ? null : "Complete Stripe verification and add an eligible bank account before accepting payments.",
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, status }, "Failed to retrieve manufacturer Connect status");
      res.status(500).json({ error: "Failed to retrieve Connect status" });
    }
  }
});

router.get("/payments", async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const mfr = await resolveManufacturer(userId);
    if (!mfr) { res.status(404).json({ error: "Manufacturer profile not found" }); return; }
    const rows = await db.select({
      event: manufacturerActivityEvents,
      orderTitle: sampleOrders.title,
      orderType: sampleOrders.orderType,
    }).from(manufacturerActivityEvents)
      .leftJoin(sampleOrders, eq(manufacturerActivityEvents.sampleOrderId, sampleOrders.id))
      .where(eq(manufacturerActivityEvents.manufacturerId, mfr.id))
      .orderBy(desc(manufacturerActivityEvents.createdAt));
    res.json(rows.filter(({ event }) => event.category === "payment" || event.category === "payout").map(({ event, ...rest }) => ({
      ...event, ...rest, createdAt: event.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list manufacturer payments");
    res.status(500).json({ error: "Failed to list payment history" });
  }
});

router.get("/onboard/return", (_req, res) => {
  res.json({ message: "Stripe Connect onboarding complete. You can close this window." });
});

router.get("/onboard/refresh", (_req, res) => {
  res.json({ message: "Onboarding link expired. Please restart the onboarding flow." });
});

export default router;

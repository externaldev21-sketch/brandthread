import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEB_ANNUAL_LOOKUP_KEYS,
  hasAnyWebAnnualPrice,
  isUsableWebAnnualPrice,
  listWebAnnualOffers,
  resetWebAnnualCache,
  resolveWebAnnualPriceForCheckout,
  webAnnualEnvName,
  webAnnualPriceIdFor,
} from "../webAnnualPrices";
import { sellerPlanFromStripeLookupKey } from "../stripePlanMapping";

const yearly = (over: Record<string, unknown> = {}) => ({
  id: "price_year1",
  active: true,
  currency: "usd",
  unit_amount: 12345,
  lookup_key: null,
  recurring: { interval: "year", interval_count: 1 },
  ...over,
});

function fakeStripe(prices: Record<string, any>) {
  return {
    prices: {
      retrieve: vi.fn(async (id: string) => {
        if (!prices[id]) throw new Error("No such price");
        return prices[id];
      }),
      update: vi.fn(async (id: string, params: Record<string, unknown>) => ({ ...prices[id], ...params })),
    },
  };
}

beforeEach(() => resetWebAnnualCache());

describe("web-only yearly price config", () => {
  it("is off unless STRIPE_PRICE_<TIER>_ANNUAL_WEB holds a Stripe price id", () => {
    expect(webAnnualEnvName("growth")).toBe("STRIPE_PRICE_GROWTH_ANNUAL_WEB");
    expect(hasAnyWebAnnualPrice({})).toBe(false);
    expect(webAnnualPriceIdFor("growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "" })).toBeNull();
    expect(webAnnualPriceIdFor("growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "79000" })).toBeNull();
    expect(webAnnualPriceIdFor("growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: " price_abc123 " })).toBe("price_abc123");
    expect(hasAnyWebAnnualPrice({ STRIPE_PRICE_PRO_ANNUAL_WEB: "price_x" })).toBe(true);
  });

  it("only accepts an active USD price billed every year with no or the expected lookup key", () => {
    expect(isUsableWebAnnualPrice(yearly(), "growth")).toBe(true);
    expect(isUsableWebAnnualPrice(yearly({ lookup_key: "brandthread_growth_annual_web" }), "growth")).toBe(true);
    expect(isUsableWebAnnualPrice(yearly({ lookup_key: "brandthread_growth_monthly" }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ lookup_key: "brandthread_pro_annual_web" }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ active: false }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ currency: "eur" }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ unit_amount: null }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ recurring: { interval: "month", interval_count: 12 } }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(yearly({ recurring: { interval: "year", interval_count: 2 } }), "growth")).toBe(false);
    expect(isUsableWebAnnualPrice(null, "growth")).toBe(false);
  });

  it("maps every yearly lookup key back to its plan for the subscription webhook", () => {
    for (const [planId, key] of Object.entries(WEB_ANNUAL_LOOKUP_KEYS)) {
      expect(sellerPlanFromStripeLookupKey(key)).toBe(planId);
    }
  });
});

describe("listWebAnnualOffers", () => {
  it("lists only configured, usable prices with Stripe's own amount, and caches", async () => {
    const stripe = fakeStripe({
      price_g: yearly({ id: "price_g", unit_amount: 50000 }),
      price_p: yearly({ id: "price_p", recurring: { interval: "month" } }),
    });
    const env = { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "price_g", STRIPE_PRICE_PRO_ANNUAL_WEB: "price_p", STRIPE_PRICE_STARTER_ANNUAL_WEB: "price_missing" };
    expect(await listWebAnnualOffers(stripe, { env, now: 1_000 })).toEqual([{ planId: "growth", amountCents: 50000 }]);
    await listWebAnnualOffers(stripe, { env, now: 2_000 });
    expect(stripe.prices.retrieve).toHaveBeenCalledTimes(3);
    await listWebAnnualOffers(stripe, { env, now: 1_000 + 11 * 60 * 1000 });
    expect(stripe.prices.retrieve).toHaveBeenCalledTimes(6);
  });
});

describe("resolveWebAnnualPriceForCheckout", () => {
  it("returns null when the plan has no yearly web price", async () => {
    const stripe = fakeStripe({});
    expect(await resolveWebAnnualPriceForCheckout(stripe, "growth", {})).toBeNull();
    expect(stripe.prices.retrieve).not.toHaveBeenCalled();
  });

  it("refuses an unusable price", async () => {
    const stripe = fakeStripe({ price_g: yearly({ currency: "gbp" }) });
    expect(await resolveWebAnnualPriceForCheckout(stripe, "growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "price_g" })).toBeNull();
  });

  it("gives a price without a lookup key the plan's yearly key so the webhook can resolve it", async () => {
    const stripe = fakeStripe({ price_g: yearly() });
    expect(await resolveWebAnnualPriceForCheckout(stripe, "growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "price_g" })).toBe("price_g");
    expect(stripe.prices.update).toHaveBeenCalledWith("price_g", { lookup_key: "brandthread_growth_annual_web", transfer_lookup_key: true });
  });

  it("leaves a price that already has the key alone", async () => {
    const stripe = fakeStripe({ price_g: yearly({ lookup_key: "brandthread_growth_annual_web" }) });
    expect(await resolveWebAnnualPriceForCheckout(stripe, "growth", { STRIPE_PRICE_GROWTH_ANNUAL_WEB: "price_g" })).toBe("price_g");
    expect(stripe.prices.update).not.toHaveBeenCalled();
  });
});

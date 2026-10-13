import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/zonos-landed-cost-only.json";
import {
  DutiesUnavailableError, ZONOS_DEFAULT_URL, ZonosDutiesProvider, decimalToCents, dutiesAtCheckoutEnabled,
  dutiesForGroup, getDutiesProvider, parseZonosLandedCost, zonosVariables, type DutiesProvider, type DutiesQuoteRequest,
} from "../duties";
import { groupChargeTotalCents } from "../../money/cartCheckout";

const request: DutiesQuoteRequest = {
  origin: { country: "US", postalCode: "10001" },
  destination: { country: "GB", postalCode: "SW1W 0NY", city: "London", street: "1 Belgrave Rd" },
  items: [{ productId: "p1", name: "Wool jacket", unitPriceCents: 12_000, quantity: 1 }],
  shippingCents: 1_800,
};

describe("decimalToCents", () => {
  it("rounds half-up without float drift", () => {
    expect(decimalToCents(14.4)).toBe(1440);
    expect(decimalToCents("30.48")).toBe(3048);
    expect(decimalToCents("0.005")).toBe(1);
    expect(decimalToCents(0)).toBe(0);
    expect(() => decimalToCents("abc")).toThrow(DutiesUnavailableError);
  });
});

describe("Zonos provider (recorded fixture)", () => {
  it("parses the landedCostOnly response into duties + taxes + fees", () => {
    const quote = parseZonosLandedCost(fixture);
    expect(quote).toEqual({
      dutiesCents: 1440 + 3048 + 250,
      breakdown: { dutiesCents: 1440, taxesCents: 3048, feesCents: 250 },
      quoteId: "landed_cost_0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6",
      provider: "zonos",
    });
  });

  it("sends the documented mutation, variables and credentialToken header", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }));
    const provider = new ZonosDutiesProvider({ apiKey: "test_token", fetchImpl });
    const quote = await provider.quote(request);
    expect(quote.dutiesCents).toBe(4738);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe(ZONOS_DEFAULT_URL);
    expect(init.headers.credentialToken).toBe("test_token");
    const body = JSON.parse(init.body);
    expect(body.query).toContain("landedCostCalculateWorkflow");
    expect(body.variables).toEqual(zonosVariables(request));
    expect(body.variables.landedCostCalculateWorkflowInput).toMatchObject({ calculationMethod: "DDP", currencyCode: "USD", endUse: "NOT_FOR_RESALE", tariffRate: "ZONOS_PREFERRED" });
    expect(body.variables.itemCreateWorkflowInput[0]).toMatchObject({ amount: 120, currencyCode: "USD", quantity: 1 });
    expect(body.variables.shipmentRatingCreateWorkflowInput).toMatchObject({ amount: 18, currencyCode: "USD" });
    expect(body.variables.partyCreateWorkflowInput.map((p: any) => p.type)).toEqual(["ORIGIN", "DESTINATION"]);
  });

  it("turns GraphQL errors, HTTP errors and non-USD answers into DutiesUnavailableError", async () => {
    expect(() => parseZonosLandedCost({ errors: [{ message: "bad token" }] })).toThrow(DutiesUnavailableError);
    expect(() => parseZonosLandedCost({ data: { landedCostCalculateWorkflow: [{ currencyCode: "GBP", amountSubtotals: { duties: 1 } }] } })).toThrow(/GBP/);
    const provider = new ZonosDutiesProvider({ apiKey: "k", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
    await expect(provider.quote(request)).rejects.toBeInstanceOf(DutiesUnavailableError);
    const throwing = new ZonosDutiesProvider({ apiKey: "k", fetchImpl: async () => { throw new Error("offline"); } });
    await expect(throwing.quote(request)).rejects.toBeInstanceOf(DutiesUnavailableError);
  });
});

describe("dutiesForGroup", () => {
  const provider: DutiesProvider = { name: "fake", quote: vi.fn(async () => ({ dutiesCents: 4738, breakdown: { dutiesCents: 1440, taxesCents: 3048, feesCents: 250 }, quoteId: "q1", provider: "fake" })) };

  it("charges duties only for a DDP zone shipping across a border", async () => {
    expect(await dutiesForGroup({ dutiesHandling: "ddp", shipFromCountry: "US", request, provider })).toEqual({ dutiesCents: 4738, quoteId: "q1" });
    expect(await dutiesForGroup({ dutiesHandling: "dap", shipFromCountry: "US", request, provider })).toEqual({ dutiesCents: 0, quoteId: null });
    expect(await dutiesForGroup({ dutiesHandling: null, shipFromCountry: "US", request, provider })).toEqual({ dutiesCents: 0, quoteId: null });
    expect(await dutiesForGroup({ dutiesHandling: "ddp", shipFromCountry: "GB", request, provider })).toEqual({ dutiesCents: 0, quoteId: null });
  });

  it("is a no-op with the flag off (no provider is even built)", async () => {
    expect(dutiesAtCheckoutEnabled({})).toBe(false);
    expect(dutiesAtCheckoutEnabled({ DUTIES_AT_CHECKOUT_ENABLED: "true" })).toBe(false); // no key
    expect(dutiesAtCheckoutEnabled({ ZONOS_API_KEY: "k" })).toBe(false); // no flag
    expect(getDutiesProvider({ ZONOS_API_KEY: "k" })).toBeNull();
    expect(await dutiesForGroup({ dutiesHandling: "ddp", shipFromCountry: "US", request, env: {} })).toEqual({ dutiesCents: 0, quoteId: null });
    expect(getDutiesProvider({ DUTIES_AT_CHECKOUT_ENABLED: "true", ZONOS_API_KEY: "k" })).toBeInstanceOf(ZonosDutiesProvider);
  });

  it("propagates a provider failure for DDP so checkout can't undercharge", async () => {
    const failing: DutiesProvider = { name: "x", quote: async () => { throw new DutiesUnavailableError("down"); } };
    await expect(dutiesForGroup({ dutiesHandling: "ddp", shipFromCountry: "US", request, provider: failing })).rejects.toBeInstanceOf(DutiesUnavailableError);
  });
});

describe("group charge total", () => {
  it("adds duties on top of subtotal + shipping − discount + tax", () => {
    expect(groupChargeTotalCents({ subtotalCents: 12_000, shippingCents: 1_800, discountCents: 1_000, taxCents: 0, dutiesCents: 4_738 }))
      .toBe(12_000 + 1_800 - 1_000 + 0 + 4_738);
  });

  it("is unchanged when there are no duties (flag off)", () => {
    const group = { subtotalCents: 5_000, shippingCents: 500, discountCents: 250, taxCents: 410 };
    expect(groupChargeTotalCents(group)).toBe(5_000 + 500 - 250 + 410);
    expect(groupChargeTotalCents({ ...group, dutiesCents: 0 })).toBe(groupChargeTotalCents(group));
  });
});

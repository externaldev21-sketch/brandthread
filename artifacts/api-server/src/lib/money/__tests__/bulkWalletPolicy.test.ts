import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREORDER_BULK_MAX_PCT, bulkWalletRefusal, bulkWalletRemainingCents, preorderBulkMaxPct, type BulkWalletInput,
} from "../bulkWalletPolicy";

function input(overrides: {
  order?: Partial<BulkWalletInput["order"]>;
  manufacturer?: Partial<BulkWalletInput["manufacturer"]>;
  seller?: Partial<BulkWalletInput["seller"]>;
  wallet?: Partial<BulkWalletInput["wallet"]>;
  maxPct?: number;
} = {}): BulkWalletInput {
  return {
    order: { issuedBy: "manufacturer", priceCents: 5_000, ...overrides.order },
    manufacturer: {
      status: "active", verifiedAt: new Date("2026-01-01"), clerkId: "user_mfr", stripeAccountId: "acct_mfr",
      emails: ["sales@factory.pt", "owner@gmail.com"], ...overrides.manufacturer,
    },
    seller: { clerkId: "user_seller", stripeAccountId: "acct_seller", email: "dev@brand.co", ...overrides.seller },
    wallet: { balanceCents: 10_000, bulkPaidCents: 0, ...overrides.wallet },
    maxPct: overrides.maxPct ?? 60,
  };
}

describe("preorderBulkMaxPct", () => {
  it("defaults to 60 and accepts 0-100", () => {
    expect(preorderBulkMaxPct({})).toBe(DEFAULT_PREORDER_BULK_MAX_PCT);
    expect(preorderBulkMaxPct({ PREORDER_BULK_MAX_PCT: "40" })).toBe(40);
    expect(preorderBulkMaxPct({ PREORDER_BULK_MAX_PCT: "140" })).toBe(60);
    expect(preorderBulkMaxPct({ PREORDER_BULK_MAX_PCT: "abc" })).toBe(60);
  });
});

describe("bulkWalletRefusal (BT-065)", () => {
  it("allows a manufacturer-quoted order to an independent verified manufacturer under the cap", () => {
    expect(bulkWalletRefusal(input())).toBeNull();
    expect(bulkWalletRefusal(input({ order: { priceCents: 6_000 } }))).toBeNull();
  });

  it("requires the manufacturer's quote", () => {
    expect(bulkWalletRefusal(input({ order: { issuedBy: "seller" } }))?.code).toBe("BULK_QUOTE_REQUIRED");
  });

  it("requires a verified, active manufacturer", () => {
    expect(bulkWalletRefusal(input({ manufacturer: { verifiedAt: null } }))?.code).toBe("MANUFACTURER_NOT_VERIFIED");
    expect(bulkWalletRefusal(input({ manufacturer: { status: "suspended" } }))?.code).toBe("MANUFACTURER_NOT_VERIFIED");
  });

  it.each([
    ["same user id", { manufacturer: { clerkId: "user_seller" } }],
    ["same Stripe account", { manufacturer: { stripeAccountId: "acct_seller" } }],
    ["same email (case-insensitive)", { seller: { email: "Owner@Gmail.com" } }],
    ["same company email domain", { seller: { email: "someone@factory.pt" } }],
  ])("refuses a manufacturer linked to the seller: %s", (_label, overrides) => {
    const refusal = bulkWalletRefusal(input(overrides as any));
    expect(refusal).toMatchObject({ status: 403, code: "MANUFACTURER_SAME_AS_SELLER" });
  });

  it("does not treat a shared public mailbox domain as the same person", () => {
    expect(bulkWalletRefusal(input({ seller: { email: "seller@gmail.com" } }))).toBeNull();
  });

  it("does not match on missing identifiers", () => {
    expect(bulkWalletRefusal(input({
      manufacturer: { clerkId: null, stripeAccountId: "acct_mfr", emails: [null, undefined] },
      seller: { stripeAccountId: null, email: null },
    }))).toBeNull();
  });

  it("caps wallet-funded bulk at the configured share of the drop's held money, counting earlier bulk payments", () => {
    expect(bulkWalletRefusal(input({ order: { priceCents: 6_001 } }))).toMatchObject({
      status: 409, code: "BULK_EXCEEDS_PREORDER_CAP", details: { capCents: 6_000, remainingCents: 6_000, maxPct: 60 },
    });
    expect(bulkWalletRefusal(input({ order: { priceCents: 2_000 }, wallet: { bulkPaidCents: 4_500 } }))).toMatchObject({
      code: "BULK_EXCEEDS_PREORDER_CAP", details: { remainingCents: 1_500 },
    });
    expect(bulkWalletRefusal(input({ order: { priceCents: 9_000 }, maxPct: 100 }))).toBeNull();
  });

  it("bulkWalletRemainingCents never goes negative", () => {
    expect(bulkWalletRemainingCents(10_000, 0, 60)).toBe(6_000);
    expect(bulkWalletRemainingCents(10_000, 7_000, 60)).toBe(0);
    expect(bulkWalletRemainingCents(-5, 0, 60)).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<{ ownerId: string; settings: unknown }>, queried: 0 }));

vi.mock("drizzle-orm", () => ({ inArray: (...values: unknown[]) => values }));
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          state.queried += 1;
          return state.rows;
        },
      }),
    }),
  },
  sellerSettings: { ownerId: "owner_id", settings: "settings" },
}));

import {
  DEFAULT_SELLER_CHECKOUT_SETTINGS,
  MAX_TIP_CENTS,
  checkTip,
  checkoutSettingsPatchError,
  loadSellerCheckoutSettings,
  normalizeSellerCheckoutSettings,
} from "../sellerCheckoutSettings";

beforeEach(() => {
  state.rows = [];
  state.queried = 0;
});

describe("normalizeSellerCheckoutSettings", () => {
  it("defaults to guest checkout allowed and tipping off", () => {
    expect(normalizeSellerCheckoutSettings(undefined)).toEqual(DEFAULT_SELLER_CHECKOUT_SETTINGS);
    expect(DEFAULT_SELLER_CHECKOUT_SETTINGS).toEqual({ checkoutMode: "accounts_optional", tippingEnabled: false });
  });

  it("reads stored keys and ignores invalid ones", () => {
    expect(normalizeSellerCheckoutSettings({ checkoutMode: "accounts_required", tippingEnabled: true, storeLanguage: "fr" }))
      .toEqual({ checkoutMode: "accounts_required", tippingEnabled: true });
    expect(normalizeSellerCheckoutSettings({ checkoutMode: "checkout_only", tippingEnabled: "yes" }))
      .toEqual(DEFAULT_SELLER_CHECKOUT_SETTINGS);
  });
});

describe("checkoutSettingsPatchError", () => {
  it("lets other seller settings through", () => {
    expect(checkoutSettingsPatchError({ storeLanguage: "es" })).toBeNull();
    expect(checkoutSettingsPatchError({ checkoutMode: "accounts_required", tippingEnabled: false })).toBeNull();
  });

  it("refuses invalid checkout values and non-objects", () => {
    expect(checkoutSettingsPatchError({ checkoutMode: "everyone" })).toMatch(/checkoutMode/);
    expect(checkoutSettingsPatchError({ tippingEnabled: "true" })).toMatch(/tippingEnabled/);
    expect(checkoutSettingsPatchError(null)).toMatch(/object/);
    expect(checkoutSettingsPatchError([])).toMatch(/object/);
  });
});

describe("checkTip", () => {
  it("always accepts no tip", () => {
    expect(checkTip({ tipCents: 0, subtotalCents: 1000, tippingEnabled: false })).toEqual({ ok: true });
  });

  it("refuses a tip when the seller has tipping off", () => {
    expect(checkTip({ tipCents: 100, subtotalCents: 1000, tippingEnabled: false }))
      .toMatchObject({ ok: false, code: "TIPPING_DISABLED" });
  });

  it("accepts a tip up to the items' subtotal", () => {
    expect(checkTip({ tipCents: 1000, subtotalCents: 1000, tippingEnabled: true })).toEqual({ ok: true });
    expect(checkTip({ tipCents: 1001, subtotalCents: 1000, tippingEnabled: true })).toMatchObject({ ok: false, code: "INVALID_TIP" });
  });

  it("caps tips on very large orders and refuses malformed amounts", () => {
    expect(checkTip({ tipCents: MAX_TIP_CENTS + 1, subtotalCents: MAX_TIP_CENTS * 10, tippingEnabled: true }))
      .toMatchObject({ ok: false, code: "INVALID_TIP" });
    expect(checkTip({ tipCents: -1, subtotalCents: 1000, tippingEnabled: true })).toMatchObject({ ok: false });
    expect(checkTip({ tipCents: 1.5, subtotalCents: 1000, tippingEnabled: true })).toMatchObject({ ok: false });
  });
});

describe("loadSellerCheckoutSettings", () => {
  it("returns stored settings and defaults for sellers without a row", async () => {
    state.rows = [{ ownerId: "seller-a", settings: { tippingEnabled: true, checkoutMode: "accounts_required" } }];
    const map = await loadSellerCheckoutSettings(["seller-a", "seller-b", "seller-a"]);
    expect(map.get("seller-a")).toEqual({ checkoutMode: "accounts_required", tippingEnabled: true });
    expect(map.get("seller-b")).toEqual(DEFAULT_SELLER_CHECKOUT_SETTINGS);
    expect(state.queried).toBe(1);
  });

  it("does not query for an empty list", async () => {
    expect((await loadSellerCheckoutSettings([])).size).toBe(0);
    expect(state.queried).toBe(0);
  });
});

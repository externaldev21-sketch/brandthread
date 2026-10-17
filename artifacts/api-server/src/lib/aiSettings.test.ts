import { describe, expect, it } from "vitest";
import { applyDataSourceSettings, DEFAULT_AI_SETTINGS, EXCLUDED_BY_SETTINGS, normalizeAISettings } from "./aiSettings";
import type { SellerSnapshot } from "./sellerSnapshot";

describe("AI settings helpers", () => {
  it("normalizes over a base, keeping every data source", () => {
    const n = normalizeAISettings({ suggestionsEnabled: false, dataSources: { marketing: false } });
    expect(n.suggestionsEnabled).toBe(false);
    expect(n.dataSources.marketing).toBe(false);
    expect(Object.keys(n.dataSources)).toEqual(Object.keys(DEFAULT_AI_SETTINGS.dataSources));
  });

  it("withholds every snapshot section a switched-off source controls", () => {
    const snapshot = {
      snapshotAt: "now", customers: { totalCustomers: 3 }, conversations: { totalUnread: 1 }, products: { totalActive: 2 },
    } as unknown as SellerSnapshot;
    const ds = { ...DEFAULT_AI_SETTINGS.dataSources, customers: false };
    const { snapshot: out, excluded } = applyDataSourceSettings(snapshot, ds);
    expect(excluded).toEqual(["customers"]);
    expect(out.customers).toBe(EXCLUDED_BY_SETTINGS);
    expect(out.conversations).toBe(EXCLUDED_BY_SETTINGS);
    expect(out.products).toEqual({ totalActive: 2 });
  });
});

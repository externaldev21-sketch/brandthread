import { describe, expect, it } from "vitest";
import {
  allPromoProductIds,
  applyPromotionCredit,
  featuredProductId,
  findPurchaseInPayload,
  grantPromotionPurchase,
  iapPromotionsEnabled,
  isUndelivered,
  parsePromoProductId,
  promoProductId,
  promotionPurchaseFromWebhookEvent,
  type ActivateResult,
  type PromoKind,
  type PromoStore,
  type PurchaseRow,
} from "../iapPromotions";

function memoryStore(opts: {
  targets?: Array<{ kind: PromoKind; id: string; ownerId: string; budgetCents: number }>;
  activate?: ActivateResult;
} = {}) {
  const purchases = new Map<string, PurchaseRow>();
  const activated: string[] = [];
  const store: PromoStore = {
    async claimPurchase(row) {
      const existing = purchases.get(row.transactionId);
      if (existing) return { created: false, purchase: existing };
      const purchase: PurchaseRow = { ...row, targetId: null, grantedAt: null };
      purchases.set(row.transactionId, purchase);
      return { created: true, purchase };
    },
    async findTarget(kind, ownerId, explicitId) {
      const t = (opts.targets ?? []).find((x) =>
        x.kind === kind && x.ownerId === ownerId && (!explicitId || x.id === explicitId));
      return t ? { id: t.id, budgetCents: t.budgetCents } : null;
    },
    async activate(_kind, id) {
      activated.push(id);
      return opts.activate ?? "activated";
    },
    async markGranted(tx, targetId, at) {
      const p = purchases.get(tx)!;
      p.targetId = targetId;
      p.grantedAt = at;
    },
    async claimCredit(appUserId, kind, amountCents, targetId, at) {
      const p = [...purchases.values()].find((x) =>
        x.appUserId === appUserId && x.kind === kind && x.amountCents === amountCents && !x.grantedAt);
      if (!p) return null;
      p.targetId = targetId;
      p.grantedAt = at;
      return p.transactionId;
    },
    async releaseCredit(tx) {
      const p = purchases.get(tx)!;
      p.targetId = null;
      p.grantedAt = null;
    },
  };
  return { store, purchases, activated };
}

describe("promotion product ids", () => {
  it("round-trips every budget tier and Featured length", () => {
    for (const id of allPromoProductIds()) {
      const parsed = parsePromoProductId(id)!;
      expect(parsed).not.toBeNull();
      if (parsed.kind !== "featured_slot") expect(promoProductId(parsed.kind, parsed.amountCents / 100)).toBe(id);
    }
    expect(allPromoProductIds()).toHaveLength(17);
  });

  it("prices Featured products from the server price list", () => {
    expect(featuredProductId(7)).toBe("brandthread_featured_7d");
    expect(parsePromoProductId("brandthread_featured_7d")).toEqual({ kind: "featured_slot", amountCents: 5900 });
    expect(parsePromoProductId("brandthread_featured_5d")).toBeNull();
    expect(parsePromoProductId("brandthread_featured_7")).toBeNull();
  });

  it("rejects unknown tiers, other products and non-strings", () => {
    expect(parsePromoProductId("brandthread_boost_7")).toBeNull();
    expect(parsePromoProductId("brandthread_pro_monthly")).toBeNull();
    expect(parsePromoProductId(undefined)).toBeNull();
    expect(parsePromoProductId("brandthread_ad_25:base")).toEqual({ kind: "ad_campaign", amountCents: 2500 });
  });

  it("is on by default; only a literal false pauses it", () => {
    expect(iapPromotionsEnabled({})).toBe(true);
    expect(iapPromotionsEnabled({ IAP_PROMOTIONS_ENABLED: "true" })).toBe(true);
    expect(iapPromotionsEnabled({ IAP_PROMOTIONS_ENABLED: "false" })).toBe(false);
  });
});

describe("grantPromotionPurchase", () => {
  const base = { appUserId: "user_1", transactionId: "tx_1", productId: "brandthread_boost_25", source: "webhook" as const };

  it("activates the matching pending boost and records the transaction", async () => {
    const { store, purchases, activated } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 }],
    });
    expect(await grantPromotionPurchase(store, base)).toEqual({ status: "granted", kind: "boost", targetId: "b1" });
    expect(activated).toEqual(["b1"]);
    expect(purchases.get("tx_1")?.targetId).toBe("b1");
  });

  it("is idempotent: a redelivered transaction never activates twice", async () => {
    const { store, activated } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 }],
    });
    await grantPromotionPurchase(store, base);
    const again = await grantPromotionPurchase(store, { ...base, source: "client_verify", explicitTargetId: "b1" });
    expect(again).toEqual({ status: "already_granted", kind: "boost", targetId: "b1" });
    expect(activated).toHaveLength(1);
  });

  it("does not grant a target whose budget differs from the product bought", async () => {
    const { store, activated } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 10_000 }],
    });
    expect((await grantPromotionPurchase(store, base)).status).toBe("amount_mismatch");
    expect(activated).toEqual([]);
  });

  it("leaves the purchase recorded but ungranted when nothing is pending, then grants on retry", async () => {
    const empty = memoryStore();
    expect((await grantPromotionPurchase(empty.store, base)).status).toBe("unmatched");
    expect(empty.purchases.get("tx_1")?.grantedAt).toBeNull();

    const later = memoryStore({ targets: [{ kind: "boost", id: "b2", ownerId: "user_1", budgetCents: 2500 }] });
    await later.store.claimPurchase({ ...base, kind: "boost", amountCents: 2500 });
    expect((await grantPromotionPurchase(later.store, base)).status).toBe("granted");
  });

  it("refuses a second account claiming someone else's transaction", async () => {
    const { store, activated } = memoryStore({
      targets: [
        { kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 },
        { kind: "boost", id: "b9", ownerId: "user_2", budgetCents: 2500 },
      ],
    });
    await store.claimPurchase({ ...base, kind: "boost", amountCents: 2500 });
    const stolen = await grantPromotionPurchase(store, { ...base, appUserId: "user_2" });
    expect(stolen).toEqual({ status: "conflict" });
    expect(activated).toEqual([]);
  });

  it("ignores non-promotion products and kind mismatches", async () => {
    const { store, activated } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 }],
    });
    expect((await grantPromotionPurchase(store, { ...base, productId: "brandthread_pro_monthly" })).status).toBe("ignored");
    expect((await grantPromotionPurchase(store, { ...base, expectedKind: "ad_campaign" })).status).toBe("ignored");
    expect(activated).toEqual([]);
  });

  it("grants a team member's purchase to the store owner's target", async () => {
    const { store } = memoryStore({
      targets: [{ kind: "ad_campaign", id: "c1", ownerId: "owner_1", budgetCents: 5000 }],
    });
    const result = await grantPromotionPurchase(store, {
      appUserId: "member_1", ownerId: "owner_1", transactionId: "tx_9",
      productId: "brandthread_ad_50", source: "client_verify", explicitTargetId: "c1", expectedKind: "ad_campaign",
    });
    expect(result).toEqual({ status: "granted", kind: "ad_campaign", targetId: "c1" });
  });

  it("does not mark granted when the post is no longer eligible", async () => {
    const { store, purchases } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 }],
      activate: "ineligible",
    });
    expect((await grantPromotionPurchase(store, base)).status).toBe("ineligible");
    expect(purchases.get("tx_1")?.grantedAt).toBeNull();
  });
});

describe("store credit for undelivered purchases", () => {
  const base = { appUserId: "user_1", transactionId: "tx_1", productId: "brandthread_boost_25", source: "webhook" as const };

  it("flags every result that left a store charge undelivered", async () => {
    const { store } = memoryStore();
    const unmatched = await grantPromotionPurchase(store, base);
    expect(isUndelivered(unmatched)).toBe(true);
    expect(isUndelivered({ status: "granted", kind: "boost", targetId: "b1" })).toBe(false);
  });

  it("applies an unmatched purchase to the next promotion of the same amount, once", async () => {
    const { store, purchases, activated } = memoryStore({
      targets: [
        { kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 },
        { kind: "boost", id: "b2", ownerId: "user_1", budgetCents: 2500 },
      ],
    });
    await store.claimPurchase({ ...base, kind: "boost", amountCents: 2500 });
    const first = await applyPromotionCredit(store, { appUserId: "user_1", kind: "boost", targetId: "b1" });
    expect(first).toMatchObject({ status: "granted", targetId: "b1", transactionId: "tx_1" });
    expect(purchases.get("tx_1")?.targetId).toBe("b1");
    const second = await applyPromotionCredit(store, { appUserId: "user_1", kind: "boost", targetId: "b2" });
    expect(second.status).toBe("no_credit");
    expect(activated).toEqual(["b1"]);
  });

  it("never applies credit of a different amount, kind or owner", async () => {
    const { store } = memoryStore({
      targets: [
        { kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 5000 },
        { kind: "ad_campaign", id: "c1", ownerId: "user_1", budgetCents: 2500 },
        { kind: "boost", id: "b9", ownerId: "user_2", budgetCents: 2500 },
      ],
    });
    await store.claimPurchase({ ...base, kind: "boost", amountCents: 2500 });
    expect((await applyPromotionCredit(store, { appUserId: "user_1", kind: "boost", targetId: "b1" })).status).toBe("no_credit");
    expect((await applyPromotionCredit(store, { appUserId: "user_1", kind: "ad_campaign", targetId: "c1" })).status).toBe("no_credit");
    expect((await applyPromotionCredit(store, { appUserId: "user_2", kind: "boost", targetId: "b9" })).status).toBe("no_credit");
  });

  it("returns the credit when the target cannot run", async () => {
    const { store, purchases } = memoryStore({
      targets: [{ kind: "boost", id: "b1", ownerId: "user_1", budgetCents: 2500 }],
      activate: "ineligible",
    });
    await store.claimPurchase({ ...base, kind: "boost", amountCents: 2500 });
    expect((await applyPromotionCredit(store, { appUserId: "user_1", kind: "boost", targetId: "b1" })).status).toBe("ineligible");
    expect(purchases.get("tx_1")?.grantedAt).toBeNull();
  });

  it("grants a Featured purchase to the seller's pending slot at the list price", async () => {
    const { store } = memoryStore({
      targets: [{ kind: "featured_slot", id: "f1", ownerId: "user_1", budgetCents: 5900 }],
    });
    const result = await grantPromotionPurchase(store, {
      ...base, productId: "brandthread_featured_7d", source: "client_verify", explicitTargetId: "f1", expectedKind: "featured_slot",
    });
    expect(result).toEqual({ status: "granted", kind: "featured_slot", targetId: "f1" });
  });
});

describe("RevenueCat payload helpers", () => {
  it("accepts only consumable purchase events for promotion products", () => {
    const ok = { type: "NON_RENEWING_PURCHASE", app_user_id: "u", transaction_id: "t", product_id: "brandthread_ad_10" };
    expect(promotionPurchaseFromWebhookEvent(ok)).toEqual({ appUserId: "u", transactionId: "t", productId: "brandthread_ad_10" });
    expect(promotionPurchaseFromWebhookEvent({ ...ok, type: "INITIAL_PURCHASE" })).toBeNull();
    expect(promotionPurchaseFromWebhookEvent({ ...ok, product_id: "brandthread_starter_monthly" })).toBeNull();
  });

  it("finds a purchase by store transaction id and resolves the store product id", () => {
    const payload = { items: [
      { id: "purch_a", store_purchase_identifier: "tx_other", product_id: "prod_x" },
      { id: "purch_b", store_purchase_identifier: "tx_1", product_id: "prod_y" },
    ] };
    expect(findPurchaseInPayload(payload, { prod_y: "brandthread_boost_50" }, "tx_1"))
      .toEqual({ productId: "brandthread_boost_50", transactionId: "tx_1" });
    expect(findPurchaseInPayload(payload, {}, "tx_missing")).toBeNull();
    expect(findPurchaseInPayload(null, {}, "tx_1")).toBeNull();
  });
});

/**
 * A second store purchase verified against a promotion that another purchase
 * already paid for must stay unspent credit (BT-022), not be marked as
 * delivered to that promotion.
 */
import { describe, expect, it } from "vitest";
import {
  applyPromotionCredit,
  grantPromotionPurchase,
  isUndelivered,
  type ActivateResult,
  type PromoStore,
  type PurchaseRow,
} from "../iapPromotions";

function store() {
  const purchases = new Map<string, PurchaseRow>();
  const active = new Set<string>();
  const s: PromoStore = {
    async claimPurchase(row) {
      const existing = purchases.get(row.transactionId);
      if (existing) return { created: false, purchase: existing };
      const purchase: PurchaseRow = { ...row, targetId: null, grantedAt: null };
      purchases.set(row.transactionId, purchase);
      return { created: true, purchase };
    },
    async findTarget(kind, ownerId, explicitId) {
      if (kind !== "boost" || ownerId !== "user_1") return null;
      if (explicitId) return explicitId === "b1" ? { id: "b1", budgetCents: 2500 } : null;
      return active.has("b1") ? null : { id: "b1", budgetCents: 2500 }; // pending only
    },
    async activate(_kind, id): Promise<ActivateResult> {
      if (active.has(id)) return "already_active";
      active.add(id);
      return "activated";
    },
    async markGranted(tx, targetId, at) {
      const p = purchases.get(tx)!;
      if (p.grantedAt) return;
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
    async grantedPurchaseFor(kind, targetId) {
      return [...purchases.values()].find((p) => p.kind === kind && p.targetId === targetId && p.grantedAt)?.transactionId ?? null;
    },
  };
  return { s, purchases, active };
}

const buy = (transactionId: string, extra: Partial<Parameters<typeof grantPromotionPurchase>[1]> = {}) => ({
  appUserId: "user_1", transactionId, productId: "brandthread_boost_25", source: "webhook" as const, ...extra,
});

describe("grantPromotionPurchase — target already funded (audit)", () => {
  it("keeps a second purchase as credit instead of marking it granted to the funded boost", async () => {
    const { s, purchases } = store();
    expect((await grantPromotionPurchase(s, buy("tx_1"))).status).toBe("granted");
    // Second purchase: the webhook finds nothing pending (kept as credit) ...
    expect((await grantPromotionPurchase(s, buy("tx_2"))).status).toBe("unmatched");
    // ... then the app's verify call names the boost tx_1 already paid for.
    const verify = await grantPromotionPurchase(s, buy("tx_2", { source: "client_verify", explicitTargetId: "b1", expectedKind: "boost" }));
    expect(verify).toEqual({ status: "ineligible", kind: "boost", targetId: "b1" });
    expect(isUndelivered(verify)).toBe(true);
    expect(purchases.get("tx_2")?.grantedAt).toBeNull();
    expect(purchases.get("tx_1")?.targetId).toBe("b1");
  });

  it("the kept credit pays for the seller's next promotion", async () => {
    const { s, active } = store();
    await grantPromotionPurchase(s, buy("tx_1"));
    await grantPromotionPurchase(s, buy("tx_2", { source: "client_verify", explicitTargetId: "b1" }));
    active.clear(); // a new pending boost "b1" for the sake of the fake
    const credit = await applyPromotionCredit(s, { appUserId: "user_1", kind: "boost", targetId: "b1", now: new Date(Date.now() + 10 * 60_000) });
    expect(credit).toMatchObject({ status: "granted", transactionId: "tx_2" });
  });

  it("still records a retried grant of the purchase that activated the target", async () => {
    const { s, purchases, active } = store();
    // Earlier attempt of tx_1 activated b1 but crashed before markGranted.
    await s.claimPurchase({ transactionId: "tx_1", appUserId: "user_1", productId: "brandthread_boost_25", kind: "boost", amountCents: 2500, source: "webhook" });
    active.add("b1");
    const retry = await grantPromotionPurchase(s, buy("tx_1", { source: "client_verify", explicitTargetId: "b1" }));
    expect(retry).toEqual({ status: "granted", kind: "boost", targetId: "b1" });
    expect(purchases.get("tx_1")?.grantedAt).not.toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  applyReviewEvent, buildRiskView, computeOrderRisk, withRiskView, HIGH_VALUE_THRESHOLD_CENTS,
} from "./orderRisk";
import { applyReviewToOrders, enrichOrderRisk, type EnrichInput } from "./orderRiskStore";

const codes = (r: ReturnType<typeof computeOrderRisk>) => r.flags.map((f) => f.code);

describe("computeOrderRisk", () => {
  it("returns normal with no flags for a null outcome and no checks", () => {
    expect(computeOrderRisk({ outcome: null, cardChecks: null })).toEqual({ level: "normal", score: null, flags: [] });
    expect(computeOrderRisk({})).toEqual({ level: "normal", score: null, flags: [] });
  });

  it("maps Radar highest and elevated", () => {
    const hi = computeOrderRisk({ outcome: { risk_level: "highest", risk_score: 92.4, type: "authorized" } });
    expect(hi.level).toBe("highest");
    expect(hi.score).toBe(92);
    expect(codes(hi)).toEqual(["radar_highest"]);
    const el = computeOrderRisk({ outcome: { risk_level: "elevated", risk_score: 70 } });
    expect(el.level).toBe("elevated");
    expect(codes(el)).toEqual(["radar_elevated"]);
  });

  it("ignores normal / not_assessed / unknown risk levels", () => {
    for (const risk_level of ["normal", "not_assessed", "weird", null]) {
      expect(computeOrderRisk({ outcome: { risk_level: risk_level as any } }).level).toBe("normal");
    }
  });

  it("maps outcome types manual_review and blocked", () => {
    const r = computeOrderRisk({ outcome: { type: "manual_review" } });
    expect(codes(r)).toEqual(["radar_manual_review"]);
    expect(r.level).toBe("elevated");
    const b = computeOrderRisk({ outcome: { type: "blocked" } });
    expect(codes(b)).toEqual(["radar_blocked"]);
    expect(b.flags[0].severity).toBe("high");
    expect(computeOrderRisk({ outcome: { type: "authorized" } }).flags).toEqual([]);
  });

  it("maps each failed card check and ignores pass/unavailable/unchecked/missing", () => {
    expect(codes(computeOrderRisk({ cardChecks: { cvc_check: "fail" } }))).toEqual(["cvc_failed"]);
    expect(codes(computeOrderRisk({ cardChecks: { address_line1_check: "fail" } }))).toEqual(["address_line1_failed"]);
    expect(codes(computeOrderRisk({ cardChecks: { address_postal_code_check: "fail" } }))).toEqual(["postal_code_failed"]);
    const all = computeOrderRisk({ cardChecks: { cvc_check: "fail", address_line1_check: "fail", address_postal_code_check: "fail" } });
    expect(codes(all)).toEqual(["cvc_failed", "address_line1_failed", "postal_code_failed"]);
    expect(all.level).toBe("elevated");
    for (const v of ["pass", "unavailable", "unchecked", null, undefined]) {
      expect(computeOrderRisk({ cardChecks: { cvc_check: v, address_line1_check: v, address_postal_code_check: v } }).flags).toEqual([]);
    }
    expect(computeOrderRisk({ cardChecks: {} }).flags).toEqual([]);
  });

  it("flags billing vs shipping country mismatch case-insensitively and ignores missing/invalid", () => {
    const m = computeOrderRisk({ billingCountry: "us", shippingCountry: "GB" });
    expect(codes(m)).toEqual(["country_mismatch"]);
    expect(m.flags[0].label).toContain("US");
    expect(m.level).toBe("elevated");
    expect(computeOrderRisk({ billingCountry: "US", shippingCountry: "us" }).flags).toEqual([]);
    expect(computeOrderRisk({ billingCountry: null, shippingCountry: "GB" }).flags).toEqual([]);
    expect(computeOrderRisk({ billingCountry: "United States", shippingCountry: "GB" }).flags).toEqual([]);
  });

  it("high value and first-time buyer are info alone, elevated together", () => {
    const hv = computeOrderRisk({ totalCents: HIGH_VALUE_THRESHOLD_CENTS });
    expect(codes(hv)).toEqual(["high_value"]);
    expect(hv.level).toBe("normal");
    expect(computeOrderRisk({ totalCents: HIGH_VALUE_THRESHOLD_CENTS - 1 }).flags).toEqual([]);
    const first = computeOrderRisk({ isFirstOrder: true });
    expect(codes(first)).toEqual(["first_time_buyer"]);
    expect(first.level).toBe("normal");
    expect(computeOrderRisk({ isFirstOrder: null }).flags).toEqual([]);
    const both = computeOrderRisk({ totalCents: 50_000, isFirstOrder: true });
    expect(codes(both)).toEqual(["high_value", "first_time_buyer"]);
    expect(both.level).toBe("elevated");
  });

  it("never lowers Radar's level and respects a custom threshold", () => {
    expect(computeOrderRisk({ outcome: { risk_level: "highest" }, cardChecks: { cvc_check: "fail" } }).level).toBe("highest");
    expect(codes(computeOrderRisk({ totalCents: 5000, highValueCents: 5000 }))).toEqual(["high_value"]);
  });
});

describe("applyReviewEvent", () => {
  const base = { level: "normal" as const, flags: [], reviewed: false };
  it("opened adds a flag once, elevates and marks unreviewed", () => {
    const a = applyReviewEvent(base, "opened", {});
    const b = applyReviewEvent(a, "opened", {});
    expect(b.flags.map((f) => f.code)).toEqual(["stripe_review_open"]);
    expect(b.level).toBe("elevated");
    expect(b.reviewed).toBe(false);
    expect(applyReviewEvent({ ...base, level: "highest" }, "opened", {}).level).toBe("highest");
    expect(applyReviewEvent({ level: null, flags: [], reviewed: null }, "opened", {}).level).toBe("elevated");
  });
  it("closed removes the open flag and sets reviewed", () => {
    const opened = applyReviewEvent(base, "opened", {});
    const closed = applyReviewEvent(opened, "closed", { reason: "approved" });
    expect(closed.flags).toEqual([]);
    expect(closed.reviewed).toBe(true);
    expect(closed.level).toBe("elevated");
  });
  it("closed as refunded_as_fraud escalates", () => {
    const closed = applyReviewEvent(base, "closed", { reason: "refunded_as_fraud" });
    expect(closed.level).toBe("highest");
    expect(closed.flags.map((f) => f.code)).toEqual(["review_refunded_as_fraud"]);
  });
});

describe("API response shape", () => {
  it("buildRiskView returns null when nothing is recorded", () => {
    expect(buildRiskView({})).toBeNull();
    expect(buildRiskView({ riskLevel: null })).toBeNull();
    expect(buildRiskView({ riskLevel: "bogus" })).toBeNull();
  });
  it("buildRiskView returns the normalised object and drops malformed flags", () => {
    expect(buildRiskView({
      riskLevel: "elevated", riskScore: 66, riskReviewed: null,
      riskFlags: [{ code: "cvc_failed", label: "x", severity: "medium" }, { nope: 1 }, null],
    })).toEqual({ level: "elevated", score: 66, reviewed: false, flags: [{ code: "cvc_failed", label: "x", severity: "medium" }] });
    expect(buildRiskView({ riskLevel: "normal", riskFlags: null })).toEqual({ level: "normal", score: null, flags: [], reviewed: false });
  });
  it("withRiskView replaces raw columns with a single risk object", () => {
    const out = withRiskView({
      id: "o1", riskLevel: "highest", riskScore: 90, riskFlags: [], riskReviewed: true, status: "pending",
    });
    expect(Object.keys(out).sort()).toEqual(["id", "risk", "status"]);
    expect(out.risk).toEqual({ level: "highest", score: 90, flags: [], reviewed: true });
    expect(withRiskView({ id: "o2" }).risk).toBeNull();
  });
});

describe("enrichOrderRisk", () => {
  const input: EnrichInput = {
    orderId: "o1", buyerId: "u1", guestEmail: null, totalCents: 40_000, shippingCountry: "US",
    radar: { outcome: { risk_level: "elevated", risk_score: 65 }, cardChecks: { cvc_check: "fail" }, billingCountry: "CA" },
  };

  it("saves computed risk", async () => {
    const saveRisk = vi.fn().mockResolvedValue(undefined);
    const risk = await enrichOrderRisk({ countPriorOrders: async () => 0, saveRisk }, input);
    expect(risk?.level).toBe("elevated");
    expect(risk?.flags.map((f) => f.code)).toEqual(
      ["radar_elevated", "cvc_failed", "country_mismatch", "high_value", "first_time_buyer"],
    );
    expect(saveRisk).toHaveBeenCalledWith("o1", risk);
  });

  it("never throws when saving fails and reports the error", async () => {
    const onError = vi.fn();
    const res = await enrichOrderRisk({
      countPriorOrders: async () => 1,
      saveRisk: async () => { throw new Error("db down"); },
      onError,
    }, input);
    expect(res).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("never throws when the prior-order lookup fails or onError throws", async () => {
    const saveRisk = vi.fn().mockResolvedValue(undefined);
    const res = await enrichOrderRisk({
      countPriorOrders: async () => { throw new Error("boom"); },
      saveRisk,
    }, input);
    expect(res?.flags.map((f) => f.code)).not.toContain("first_time_buyer");
    await expect(enrichOrderRisk({
      countPriorOrders: async () => 0,
      saveRisk: async () => { throw new Error("x"); },
      onError: () => { throw new Error("y"); },
    }, input)).resolves.toBeNull();
  });

  it("handles missing radar data and malformed input", async () => {
    const saveRisk = vi.fn().mockResolvedValue(undefined);
    const res = await enrichOrderRisk({ countPriorOrders: async () => 3, saveRisk }, {
      ...input, radar: undefined, totalCents: null, shippingCountry: null, buyerId: null, guestEmail: null,
    });
    expect(res).toEqual({ level: "normal", score: null, flags: [] });
    const bad = await enrichOrderRisk({ countPriorOrders: async () => 0, saveRisk }, { ...input, radar: { outcome: 5 as any, cardChecks: "x" as any, billingCountry: 9 as any } });
    expect(bad).not.toBeUndefined();
  });
});

describe("applyReviewToOrders", () => {
  it("updates every order on the payment intent", async () => {
    const updateRisk = vi.fn().mockResolvedValue(undefined);
    const findOrders = vi.fn().mockResolvedValue([
      { id: "a", riskLevel: null, riskFlags: null, riskReviewed: null },
      { id: "b", riskLevel: "elevated", riskFlags: [], riskReviewed: false },
    ]);
    const n = await applyReviewToOrders({ findOrders, updateRisk }, "opened", { payment_intent: "pi_1", charge: { id: "ch_1" } });
    expect(n).toBe(2);
    expect(findOrders).toHaveBeenCalledWith({ paymentIntentId: "pi_1", chargeId: "ch_1" });
    expect(updateRisk).toHaveBeenCalledWith("a", expect.objectContaining({ riskLevel: "elevated", riskReviewed: false }));
    await applyReviewToOrders({ findOrders, updateRisk }, "closed", { payment_intent: "pi_1" });
    expect(updateRisk).toHaveBeenLastCalledWith("b", expect.objectContaining({ riskReviewed: true }));
  });
  it("does nothing without a payment reference", async () => {
    const findOrders = vi.fn();
    expect(await applyReviewToOrders({ findOrders, updateRisk: vi.fn() }, "opened", {})).toBe(0);
    expect(findOrders).not.toHaveBeenCalled();
  });
});

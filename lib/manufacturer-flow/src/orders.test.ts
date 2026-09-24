import { describe, expect, it } from "vitest";
import {
  PRODUCTION_STAGES,
  buildTimeline,
  deriveCardState,
  nextProductionStage,
  parseAmountToCents,
  validateCardInput,
  validateTransition,
} from "./orders";

describe("validateTransition — payment", () => {
  it("only the payment system can move an unpaid card to payment_received", () => {
    expect(validateTransition({ from: "pending_payment", to: "payment_received", actor: "payment_system" })).toEqual({ ok: true });
    for (const actor of ["seller", "manufacturer"] as const) {
      const result = validateTransition({ from: "pending_payment", to: "payment_received", actor });
      expect(result).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    }
  });

  it("blocks production before payment", () => {
    for (const to of ["processing", "cut_and_sew", "packing", "shipped", "delivered"]) {
      expect(validateTransition({ from: "pending_payment", to, actor: "manufacturer" }))
        .toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    }
  });

  it("lets either participant cancel an unpaid card but never a paid order", () => {
    expect(validateTransition({ from: "pending_payment", to: "cancelled", actor: "manufacturer" })).toEqual({ ok: true });
    expect(validateTransition({ from: "pending_payment", to: "cancelled", actor: "seller" })).toEqual({ ok: true });
    expect(validateTransition({ from: "pending_payment", to: "cancelled", actor: "payment_system" })).toMatchObject({ ok: false });
    expect(validateTransition({ from: "payment_received", to: "cancelled", actor: "manufacturer" }))
      .toMatchObject({ ok: false, code: "NOT_ALLOWED_FOR_ACTOR" });
  });
});

describe("validateTransition — tracker", () => {
  it("walks all six stages in order for the manufacturer", () => {
    for (let i = 0; i < PRODUCTION_STAGES.length - 1; i += 1) {
      const from = PRODUCTION_STAGES[i];
      const to = PRODUCTION_STAGES[i + 1];
      const extras = to === "shipped" ? { carrier: "DHL Express", trackingNumber: "1234567890" } : {};
      expect(validateTransition({ from, to, actor: "manufacturer", ...extras })).toEqual({ ok: true });
    }
  });

  it("rejects skipped, repeated and backwards stages", () => {
    expect(validateTransition({ from: "processing", to: "packing", actor: "manufacturer" })).toMatchObject({ code: "SKIPS_A_STAGE" });
    expect(validateTransition({ from: "packing", to: "packing", actor: "manufacturer" })).toMatchObject({ code: "SKIPS_A_STAGE" });
    expect(validateTransition({ from: "packing", to: "processing", actor: "manufacturer" })).toMatchObject({ code: "SKIPS_A_STAGE" });
  });

  it("requires carrier and tracking number to ship", () => {
    expect(validateTransition({ from: "packing", to: "shipped", actor: "manufacturer" })).toMatchObject({ code: "TRACKING_REQUIRED" });
    expect(validateTransition({ from: "packing", to: "shipped", actor: "manufacturer", carrier: "UPS", trackingNumber: "  " }))
      .toMatchObject({ code: "TRACKING_REQUIRED" });
  });

  it("keeps production stages manufacturer-only but lets the seller confirm delivery", () => {
    expect(validateTransition({ from: "payment_received", to: "processing", actor: "seller" })).toMatchObject({ code: "NOT_ALLOWED_FOR_ACTOR" });
    expect(validateTransition({ from: "shipped", to: "delivered", actor: "seller" })).toEqual({ ok: true });
    expect(validateTransition({ from: "shipped", to: "delivered", actor: "manufacturer" })).toEqual({ ok: true });
  });

  it("treats delivered and cancelled as final", () => {
    expect(validateTransition({ from: "delivered", to: "shipped", actor: "manufacturer" })).toMatchObject({ code: "ALREADY_FINAL" });
    expect(validateTransition({ from: "cancelled", to: "payment_received", actor: "payment_system" })).toMatchObject({ code: "ALREADY_FINAL" });
  });

  it("reports the next stage", () => {
    expect(nextProductionStage("payment_received")).toBe("processing");
    expect(nextProductionStage("shipped")).toBe("delivered");
    expect(nextProductionStage("delivered")).toBeNull();
    expect(nextProductionStage("pending_payment")).toBeNull();
  });
});

describe("validateCardInput", () => {
  const valid = { orderType: "sample", title: "Heavyweight hoodie sample", quantity: 2, priceCents: 8500 };

  it("accepts a normal sample and bulk card", () => {
    expect(validateCardInput(valid)).toEqual({ ok: true });
    expect(validateCardInput({ ...valid, orderType: "bulk", quantity: 500, priceCents: 1_250_000 })).toEqual({ ok: true });
  });

  it("reports each invalid field in plain English", () => {
    const result = validateCardInput({ orderType: "rush", title: " ", quantity: 0, priceCents: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["orderType", "priceCents", "quantity", "title"]);
      expect(result.errors.priceCents).toContain("US$1.00");
    }
  });

  it("steers large sample quantities to a bulk card and caps price", () => {
    const sample = validateCardInput({ ...valid, quantity: 200 });
    expect(sample.ok || sample.errors.quantity).toMatch(/bulk order card/);
    const pricey = validateCardInput({ ...valid, priceCents: 50_000_001 });
    expect(pricey.ok).toBe(false);
  });
});

describe("parseAmountToCents", () => {
  it("parses typed amounts into integer cents without floating point", () => {
    expect(parseAmountToCents("85")).toBe(8500);
    expect(parseAmountToCents("1,250.5")).toBe(125050);
    expect(parseAmountToCents("US$19.99")).toBe(1999);
    expect(parseAmountToCents("0.1")).toBe(10);
  });
  it("rejects malformed amounts", () => {
    for (const value of ["", "abc", "1.234", "-5", "1.2.3"]) expect(parseAmountToCents(value)).toBeNull();
  });
});

describe("deriveCardState", () => {
  it("shows Pay to the seller only when the manufacturer can receive payouts", () => {
    const payable = deriveCardState({ status: "pending_payment", orderType: "sample", manufacturerPayoutReady: true }, "seller");
    expect(payable.actions.map((a) => a.kind)).toEqual(["pay", "decline"]);
    const blocked = deriveCardState({ status: "pending_payment", orderType: "sample", manufacturerPayoutReady: false }, "seller");
    expect(blocked.actions.map((a) => a.kind)).toEqual(["decline"]);
    expect(blocked.headline).toBe("Not payable yet");
  });

  it("gives the manufacturer withdraw while unpaid and the next stage after payment", () => {
    expect(deriveCardState({ status: "pending_payment", orderType: "bulk" }, "manufacturer").actions)
      .toEqual([{ kind: "withdraw", label: "Withdraw card" }]);
    const paid = deriveCardState({ status: "payment_received", orderType: "bulk" }, "manufacturer");
    expect(paid.phase).toBe("in_production");
    expect(paid.completedStages).toBe(1);
    expect(paid.actions).toEqual([{ kind: "advance", label: "Mark processing", to: "processing", needsTracking: false }]);
    expect(deriveCardState({ status: "packing", orderType: "bulk" }, "manufacturer").actions[0])
      .toMatchObject({ to: "shipped", needsTracking: true });
  });

  it("never offers the seller production actions", () => {
    for (const status of ["payment_received", "processing", "cut_and_sew", "packing"]) {
      expect(deriveCardState({ status, orderType: "sample" }, "seller").actions).toEqual([]);
    }
  });

  it("offers tracking and delivery confirmation once shipped", () => {
    const seller = deriveCardState({ status: "shipped", orderType: "sample", trackingNumber: "1Z999" }, "seller");
    expect(seller.actions.map((a) => a.kind)).toEqual(["track", "confirm_delivery"]);
    const done = deriveCardState({ status: "delivered", orderType: "sample", trackingNumber: "1Z999" }, "seller");
    expect(done.phase).toBe("delivered");
    expect(done.completedStages).toBe(6);
  });

  it("flags payment review holds", () => {
    const held = deriveCardState({ status: "processing", orderType: "bulk", paymentReviewState: "reversed" }, "manufacturer");
    expect(held.detail).toMatch(/under review/);
  });

  it("closes cancelled cards with no actions", () => {
    expect(deriveCardState({ status: "cancelled", orderType: "bulk" }, "seller")).toMatchObject({ phase: "cancelled", actions: [] });
  });
});

describe("buildTimeline", () => {
  it("marks reached stages done, the current stage current, and keeps real timestamps", () => {
    const steps = buildTimeline(
      { status: "cut_and_sew", paidAt: "2026-09-01T10:00:00.000Z" },
      [
        { toStatus: "processing", createdAt: "2026-09-02T09:00:00.000Z" },
        { toStatus: "cut_and_sew", createdAt: "2026-09-05T09:00:00.000Z" },
      ],
    );
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(steps[0].at).toBe("2026-09-01T10:00:00.000Z");
    expect(steps[2].at).toBe("2026-09-05T09:00:00.000Z");
    expect(steps[3].at).toBeNull();
  });

  it("never invents times for stages without events", () => {
    const steps = buildTimeline({ status: "packing" }, []);
    expect(steps.slice(0, 4).every((s) => s.at === null)).toBe(true);
  });

  it("shows nothing reached for an unpaid card and everything done after delivery", () => {
    expect(buildTimeline({ status: "pending_payment" }, []).every((s) => s.state === "upcoming")).toBe(true);
    const delivered = buildTimeline({ status: "delivered", deliveredAt: "2026-09-20T00:00:00.000Z" }, []);
    expect(delivered.every((s) => s.state === "done")).toBe(true);
    expect(delivered[5].at).toBe("2026-09-20T00:00:00.000Z");
    expect(buildTimeline({ status: "approved" }, []).every((s) => s.state === "done")).toBe(true);
  });
});

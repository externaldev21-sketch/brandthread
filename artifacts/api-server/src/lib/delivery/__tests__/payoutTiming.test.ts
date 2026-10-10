import { describe, expect, it } from "vitest";
import { heldOrderTiming, heldOrderTimingRows, payoutHoldRule } from "../payoutTiming";

const hold = { PAYOUT_MODE: "hold" } as NodeJS.ProcessEnv;
const immediate = { PAYOUT_MODE: "immediate" } as NodeJS.ProcessEnv;
const base = {
  chargeModel: "transfer",
  deliverBy: new Date("2026-10-20T00:00:00Z"),
  deliveredAt: null,
  payoutReleaseAt: null,
  disputePausedAt: null,
  hasOpenReturn: false,
};

describe("payoutHoldRule", () => {
  it("defaults to hold, 3 days after delivery, 15/60 day delivery windows", () => {
    expect(payoutHoldRule({} as NodeJS.ProcessEnv)).toEqual({
      mode: "hold", bufferDays: 3, regularDeliveryDays: 15, preorderDeliveryDays: 60,
    });
  });

  it("follows PAYOUT_RELEASE_BUFFER_DAYS and PAYOUT_MODE", () => {
    const rule = payoutHoldRule({ PAYOUT_MODE: "immediate", PAYOUT_RELEASE_BUFFER_DAYS: "5" } as NodeJS.ProcessEnv);
    expect(rule.mode).toBe("immediate");
    expect(rule.bufferDays).toBe(5);
  });
});

describe("heldOrderTiming", () => {
  it("waits for delivery when the order is not delivered", () => {
    expect(heldOrderTiming(base, hold)).toEqual({ state: "awaiting_delivery", releaseAt: null });
  });

  it("gives the release date once delivered", () => {
    const releaseAt = new Date("2026-10-13T00:00:00Z");
    expect(heldOrderTiming({ ...base, deliveredAt: new Date("2026-10-10T00:00:00Z"), payoutReleaseAt: releaseAt }, hold))
      .toEqual({ state: "scheduled", releaseAt });
  });

  it("is paused by a chargeback or an open return", () => {
    const delivered = { ...base, deliveredAt: new Date("2026-10-10T00:00:00Z"), payoutReleaseAt: new Date("2026-10-13T00:00:00Z") };
    expect(heldOrderTiming({ ...delivered, disputePausedAt: new Date() }, hold).state).toBe("paused");
    expect(heldOrderTiming({ ...delivered, hasOpenReturn: true }, hold).state).toBe("paused");
  });

  it("keeps the old ship-time release for drop orders without a deadline", () => {
    expect(heldOrderTiming({ ...base, chargeModel: "held", deliverBy: null }, hold).state).toBe("on_ship");
    expect(heldOrderTiming({ ...base, chargeModel: "transfer", deliverBy: null }, hold).state).toBe("processing");
  });

  it("does not hold for delivery under PAYOUT_MODE=immediate", () => {
    expect(heldOrderTiming(base, immediate).state).toBe("processing");
    expect(heldOrderTiming({ ...base, chargeModel: "held" }, immediate).state).toBe("on_ship");
  });
});

describe("heldOrderTimingRows", () => {
  it("maps raw /summary rows (string timestamps from pg) to the API shape", () => {
    const [row] = heldOrderTimingRows([{
      id: "o1", order_number: "1042", is_preorder: true, seller_net_cents: "4250", charge_model: "transfer",
      deliver_by: "2026-11-30T00:00:00Z", delivered_at: "2026-10-08T00:00:00Z",
      payout_release_at: "2026-10-11T00:00:00Z", dispute_paused_at: null, has_open_return: false,
    }], hold);
    expect(row).toEqual({
      orderId: "o1", orderNumber: "1042", isPreorder: true, netCents: 4250, state: "scheduled",
      deliverBy: "2026-11-30T00:00:00.000Z", payoutReleaseAt: "2026-10-11T00:00:00.000Z",
    });
  });
});

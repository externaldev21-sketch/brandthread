import { describe, expect, it } from "vitest";
import { newOrderPushDelivery, readSaleAlertPrefs, saleAlertPatch } from "./saleAlerts";

describe("sale alert preferences", () => {
  it("defaults both alerts on when nothing is stored", () => {
    expect(readSaleAlertPrefs(null)).toEqual({ saleSound: true, saleHaptic: true });
    expect(readSaleAlertPrefs({ new_orders: true })).toEqual({ saleSound: true, saleHaptic: true });
    expect(readSaleAlertPrefs(["sale_sound"])).toEqual({ saleSound: true, saleHaptic: true });
  });

  it("reads explicit offs", () => {
    expect(readSaleAlertPrefs({ sale_sound: false, sale_haptic: false })).toEqual({ saleSound: false, saleHaptic: false });
  });

  it("uses the bundled sound file (underscore, matching the asset) and the orders channel", () => {
    expect(newOrderPushDelivery({})).toEqual({ pushSound: "order_received.wav", pushChannelId: "orders" });
  });

  it("falls back to the standard sound and channel when the sale sound is off", () => {
    expect(newOrderPushDelivery({ sale_sound: false })).toEqual({ pushSound: null, pushChannelId: "default" });
  });

  it("validates the PUT patch", () => {
    expect(saleAlertPatch({})).toEqual({ ok: true, patch: {} });
    expect(saleAlertPatch({ saleSound: false, saleHaptic: true })).toEqual({
      ok: true,
      patch: { sale_sound: false, sale_haptic: true },
    });
    expect(saleAlertPatch({ saleSound: "no" })).toEqual({ ok: false, error: "saleSound must be a boolean" });
    expect(saleAlertPatch({ saleHaptic: 1 })).toEqual({ ok: false, error: "saleHaptic must be a boolean" });
  });
});

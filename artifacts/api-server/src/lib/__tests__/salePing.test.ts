import { describe, expect, it } from "vitest";
import { formatPushAmount, newOrderPushBody, newOrderPushTitle, newOrderWidgetDelta } from "../salePing";

describe("sale ping copy (Apple Watch)", () => {
  it("puts the amount in a short title, dropping .00", () => {
    expect(newOrderPushTitle(9800)).toBe("New order · $98");
    expect(newOrderPushTitle(9850)).toBe("New order · $98.50");
    expect(newOrderPushTitle(124000)).toBe("New order · $1,240");
    expect(formatPushAmount(-5)).toBe("$0");
  });

  it("names the product, then how many more", () => {
    expect(newOrderPushBody({ productName: "Desires Tee", itemCount: 1, orderNumber: "BT-4821" })).toBe("Desires Tee");
    expect(newOrderPushBody({ productName: "Desires Tee", itemCount: 3, orderNumber: "BT-4821" })).toBe("Desires Tee and 2 more");
    expect(newOrderPushBody({ productName: "  ", itemCount: 1, orderNumber: "BT-4821" })).toBe("BT-4821");
    const long = newOrderPushBody({ productName: "A".repeat(60), itemCount: 1, orderNumber: "x" });
    expect(long).toHaveLength(40);
    expect(long.endsWith("…")).toBe(true);
  });

  it("widget delta is one order to ship worth the total", () => {
    expect(newOrderWidgetDelta(9800)).toEqual({ salesCents: 9800, orders: 1, toShip: 1 });
  });
});

import { salePingPushFields } from "../salePing";

describe("salePingPushFields", () => {
  const input = { totalCents: 9800, productName: "Desires Tee", itemCount: 1, orderNumber: "BT-4821" };
  it("is empty while the nativeSurfaces flag is off (or the lookup fails)", async () => {
    expect(await salePingPushFields(input, async () => false)).toEqual({});
    expect(await salePingPushFields(input, async () => { throw new Error("db down"); })).toEqual({});
  });
  it("adds the Watch copy and the widget delta when on", async () => {
    expect(await salePingPushFields(input, async () => true)).toEqual({
      pushTitle: "New order · $98",
      pushBody: "Desires Tee",
      pushData: { widgetDelta: { salesCents: 9800, orders: 1, toShip: 1 } },
    });
  });
});

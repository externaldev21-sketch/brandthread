/**
 * Item 116: the order confirmation email matches the app's confirmation —
 * an "Estimated delivery" row (only when a real date is known) and a
 * "Track order" button that opens the order in the app.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    proxy = vi.fn();
    listConnections = vi.fn().mockResolvedValue([]);
  },
}));

import {
  buildOrderConfirmationEmail,
  orderConfirmationDeliveryEstimate,
  orderDeepLink,
} from "../brandthreadEmail";
import { DEEP_LINK_PATHS } from "../../routes/wellKnown";

const base = {
  orderNumber: "BT-00042",
  items: [{ productName: "Chrome Tee", variantLabel: "M / Black", quantity: 2, priceCents: 2500 }],
  subtotalCents: 5000,
  shippingCents: 0,
  totalCents: 5000,
};

describe("orderConfirmationDeliveryEstimate", () => {
  it("words the estimate like the app's order screen", () => {
    expect(orderConfirmationDeliveryEstimate({ deliverBy: new Date("2026-10-20T12:00:00Z") })).toBe("Arrives by Oct 20");
    expect(orderConfirmationDeliveryEstimate({
      isPreorder: true,
      promisedShipDate: new Date("2026-11-30T12:00:00Z"),
      deliverBy: new Date("2026-12-14T12:00:00Z"),
    })).toBe("Seller ships by Nov 30");
    expect(orderConfirmationDeliveryEstimate({ estimatedDelivery: "2026-10-18" })).toBe("Arriving Oct 18");
  });

  it("returns null when nothing is known, so no date is invented", () => {
    expect(orderConfirmationDeliveryEstimate(null)).toBeNull();
    expect(orderConfirmationDeliveryEstimate({})).toBeNull();
    expect(orderConfirmationDeliveryEstimate({ estimatedDelivery: "soon" })).toBeNull();
    expect(orderConfirmationDeliveryEstimate({ deliverBy: new Date("nope") })).toBeNull();
    // A pre-order with no promised date falls through to the guarantee.
    expect(orderConfirmationDeliveryEstimate({ isPreorder: true, deliverBy: new Date("2026-12-01T12:00:00Z") })).toBe("Arrives by Dec 1");
  });
});

describe("buildOrderConfirmationEmail", () => {
  it("shows the estimate above the items and a Track order link to the order", () => {
    const { subject, html } = buildOrderConfirmationEmail({
      ...base,
      orderId: "8a3f8f0e-1111-4c2b-9d1e-2f0a7f1c0b42",
      delivery: { deliverBy: new Date("2026-10-20T12:00:00Z") },
    });
    expect(subject).toBe("Brandthread order BT-00042 confirmed");
    expect(html).toContain("Estimated delivery");
    expect(html).toContain("Arrives by Oct 20");
    expect(html.indexOf("Estimated delivery")).toBeLessThan(html.indexOf("Chrome Tee"));
    expect(html).toContain(">Track order</a>");
    expect(html).toContain('href="https://brandthread.app/buyer-order-detail?id=8a3f8f0e-1111-4c2b-9d1e-2f0a7f1c0b42"');
    expect(html).not.toContain("View your order");
  });

  it("omits the row when no estimate exists and keeps the orders link without an order id", () => {
    const { html } = buildOrderConfirmationEmail({ ...base, orderId: null, delivery: {} });
    expect(html).not.toContain("Estimated delivery");
    expect(html).toContain('href="https://brandthread.app/orders"');
    expect(html).toContain(">View your order</a>");
  });

  it("encodes the order id in the link", () => {
    expect(orderDeepLink("a b&c")).toBe("https://brandthread.app/buyer-order-detail?id=a%20b%26c");
  });

  it("links to a path the app claims as a universal link", () => {
    expect(DEEP_LINK_PATHS).toContain("/buyer-order-detail*");
  });
});

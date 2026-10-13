import { describe, expect, it } from "vitest";
import { apiRelativePath, isPackerRequestAllowed, redactBuyerContact } from "../packerAccess";

describe("packer allowlist", () => {
  const allowed: Array<[string, string, unknown?]> = [
    ["GET", "/orders"],
    ["GET", "/orders/abc"],
    ["PATCH", "/orders/abc/status", { status: "processing" }],
    ["PATCH", "/orders/abc/status", { status: "fulfilled" }],
    ["PATCH", "/orders/abc/status", { status: "shipped" }],
    ["PATCH", "/orders/abc/tracking"],
    ["PATCH", "/orders/abc/items-tracking"],
    ["PATCH", "/orders/abc/fulfillment-checklist"],
    ["GET", "/shipping-labels/abc/parcel-suggestion"],
    ["POST", "/shipping-labels/abc/rates"],
    ["POST", "/shipping-labels/abc/purchase"],
    ["POST", "/shipping-labels/abc/lbl/void"],
    ["GET", "/team/context"],
    ["POST", "/team/context"],
    ["POST", "/team/invite/accept/tok"],
    ["POST", "/team/accept/tok"],
  ];
  for (const [method, path, body] of allowed) {
    it(`allows ${method} ${path}`, () => expect(isPackerRequestAllowed(method, path, body)).toBe(true));
  }

  const denied: Array<[string, string, unknown?]> = [
    ["POST", "/orders"],
    ["DELETE", "/orders/abc"],
    ["PATCH", "/orders/abc/status", { status: "cancelled" }],
    ["PATCH", "/orders/abc/status", { status: "pending" }],
    ["PATCH", "/orders/abc/status", {}],
    ["GET", "/orders/abc/refunds"],
    ["POST", "/orders/abc/refund"],
    ["GET", "/products"],
    ["GET", "/customers"],
    ["GET", "/analytics/dashboard"],
    ["GET", "/finance/balance"],
    ["GET", "/team/members"],
    ["POST", "/team/invite"],
    ["GET", "/seller/settings"],
    ["GET", "/returns"],
    ["GET", "/shipping-labels/abc/rates"],
    ["GET", "/ordersx"],
  ];
  for (const [method, path, body] of denied) {
    it(`denies ${method} ${path}`, () => expect(isPackerRequestAllowed(method, path, body)).toBe(false));
  }
});

describe("apiRelativePath", () => {
  it("strips /api and /api/v1 and the query", () => {
    expect(apiRelativePath({ originalUrl: "/api/orders?x=1" } as any)).toBe("/orders");
    expect(apiRelativePath({ originalUrl: "/api/v1/orders/abc" } as any)).toBe("/orders/abc");
    expect(apiRelativePath({ originalUrl: "/api" } as any)).toBe("/");
  });
});

describe("redactBuyerContact", () => {
  it("blanks emails and phones at any depth and keeps the address", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const out = redactBuyerContact({
      customerEmail: "a@b.c",
      guestEmail: "g@b.c",
      createdAt,
      customer: { name: "Bea", email: "a@b.c", phone: "+1555" },
      shippingAddress: { name: "Bea", line1: "1 Lane", phone: "+1555", email: "a@b.c" },
      items: [{ productName: "Tee", buyerPhone: 15550001111 }],
      emailSent: true,
    });
    expect(out).toEqual({
      customerEmail: null,
      guestEmail: null,
      createdAt,
      customer: { name: "Bea", email: null, phone: null },
      shippingAddress: { name: "Bea", line1: "1 Lane", phone: null, email: null },
      items: [{ productName: "Tee", buyerPhone: null }],
      emailSent: true,
    });
  });
});

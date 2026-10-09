import { describe, expect, it, vi } from "vitest";

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {},
}));
vi.mock("@workspace/db", () => ({
  db: {},
  sellerSubscriptionEntitlements: {},
  users: {},
}));

import { resolveEffectiveEntitlement } from "../nativeEntitlements";

const now = new Date("2026-08-31T12:00:00.000Z");

function native(overrides: Record<string, unknown> = {}) {
  return {
    planId: "pro",
    status: "active",
    expiresAt: new Date("2026-09-30T12:00:00.000Z"),
    ...overrides,
  } as any;
}

function stripe(overrides: Record<string, unknown> = {}) {
  return {
    planId: "growth",
    status: "active",
    ...overrides,
  };
}

describe("resolveEffectiveEntitlement", () => {
  it("keeps the strongest valid native entitlement when Stripe is lower", () => {
    expect(resolveEffectiveEntitlement(stripe(), native(), now)).toMatchObject({
      planId: "pro",
      provider: "revenuecat",
    });
  });

  it("keeps native access when the legacy Stripe subscription is canceled", () => {
    expect(resolveEffectiveEntitlement(
      stripe({ planId: "pro", status: "canceled" }),
      native({ planId: "growth" }),
      now,
    )).toMatchObject({
      planId: "growth",
      provider: "revenuecat",
    });
  });

  it("keeps the strongest valid Stripe entitlement when native is lower", () => {
    expect(resolveEffectiveEntitlement(stripe({ planId: "pro" }), native({ planId: "growth" }), now))
      .toMatchObject({
        planId: "pro",
        provider: "stripe",
      });
  });

  it("normalizes persisted Scale records to the renamed Pro tier", () => {
    expect(resolveEffectiveEntitlement(
      stripe({ planId: "scale" }),
      native({ planId: "scale" }),
      now,
    )).toMatchObject({
      planId: "pro",
      provider: "revenuecat",
    });
  });

  it("keeps valid Stripe access when the native provider has no available snapshot", () => {
    expect(resolveEffectiveEntitlement(stripe({ planId: "growth" }), null, now)).toMatchObject({
      planId: "growth",
      provider: "stripe",
    });
  });

  it.each([
    ["expired", new Date("2026-08-30T12:00:00.000Z")],
    ["canceled", new Date("2026-09-30T12:00:00.000Z")],
  ])("falls back to Stripe when native is %s", (status, expiresAt) => {
    expect(resolveEffectiveEntitlement(stripe(), native({ status, expiresAt }), now))
      .toMatchObject({
        planId: "growth",
        provider: "stripe",
      });
  });

  it("preserves access during a valid RevenueCat grace period", () => {
    expect(resolveEffectiveEntitlement(
      { planId: "starter", status: "canceled" },
      native({ planId: "growth", status: "grace" }),
      now,
    )).toMatchObject({
      planId: "growth",
      provider: "revenuecat",
    });
  });

  it("fails closed when neither provider has a valid entitlement", () => {
    expect(resolveEffectiveEntitlement(
      { planId: "pro", status: "canceled" },
      native({ planId: "pro", status: "expired", expiresAt: new Date("2026-08-30T12:00:00.000Z") }),
      now,
    )).toMatchObject({
      planId: "starter",
      provider: "none",
    });
  });

  it("does not turn an unrecognized provider plan into paid access", () => {
    expect(resolveEffectiveEntitlement(
      stripe({ planId: "unknown" }),
      native({ planId: "also-unknown" }),
      now,
    )).toMatchObject({
      planId: "starter",
      provider: "none",
    });
  });
});
describe("past_due grace period (BT-002)", () => {
  const day = 24 * 60 * 60 * 1000;

  it("keeps the plan while Stripe retries the card", () => {
    const result = resolveEffectiveEntitlement(
      stripe({ status: "past_due", pastDueSince: new Date(now.valueOf() - 3 * day) }), null, now,
    );
    expect(result).toMatchObject({ planId: "growth", provider: "stripe" });
  });

  it("falls back to no paid access once the grace period is over", () => {
    const result = resolveEffectiveEntitlement(
      stripe({ status: "past_due", pastDueSince: new Date(now.valueOf() - 8 * day) }), null, now,
    );
    expect(result).toMatchObject({ provider: "none", status: "none" });
  });

  it("treats a past_due row not yet stamped as in grace (no lockout on deploy)", () => {
    expect(resolveEffectiveEntitlement(stripe({ status: "past_due", pastDueSince: null }), null, now).provider).toBe("stripe");
  });

  it("never grants access for canceled, unpaid or missing subscriptions", () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired", "none"]) {
      expect(resolveEffectiveEntitlement(stripe({ status }), null, now).provider).toBe("none");
    }
  });
});

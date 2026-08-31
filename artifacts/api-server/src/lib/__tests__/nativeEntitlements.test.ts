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
    planId: "scale",
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
      planId: "scale",
      provider: "revenuecat",
    });
  });

  it("keeps native access when the legacy Stripe subscription is canceled", () => {
    expect(resolveEffectiveEntitlement(
      stripe({ planId: "scale", status: "canceled" }),
      native({ planId: "growth" }),
      now,
    )).toMatchObject({
      planId: "growth",
      provider: "revenuecat",
    });
  });

  it("keeps the strongest valid Stripe entitlement when native is lower", () => {
    expect(resolveEffectiveEntitlement(stripe({ planId: "scale" }), native({ planId: "growth" }), now))
      .toMatchObject({
        planId: "scale",
        provider: "stripe",
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
      { planId: "scale", status: "canceled" },
      native({ planId: "scale", status: "expired", expiresAt: new Date("2026-08-30T12:00:00.000Z") }),
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
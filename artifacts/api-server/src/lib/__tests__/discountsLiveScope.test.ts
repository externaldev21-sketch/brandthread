/**
 * Live-only discount codes: valid only for their stream and only while it is
 * live, enforced in the shared rule engine every checkout path calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  discountRow: null as any,
  streamRow: null as any,
  streamLookups: 0,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ strings, exprs }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === "discountCodesTable") return state.discountRow ? [state.discountRow] : [];
            if (table === "liveStreamsTable") {
              state.streamLookups += 1;
              return state.streamRow ? [state.streamRow] : [];
            }
            return [];
          },
        }),
      }),
    }),
  },
  discountCodes: "discountCodesTable",
  discountCodeUses: "discountCodeUsesTable",
  liveStreams: "liveStreamsTable",
}));

import { liveScopeRejection, validateDiscountCode } from "../discounts";

const STREAM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function liveCode(overrides: Record<string, unknown> = {}) {
  return {
    id: "code-live", sellerId: "seller-1", code: "LIVE15", type: "percentage", value: "15",
    minOrderCents: 0, maxUses: null, usesCount: 0, expiresAt: null, startsAt: null,
    appliesTo: "entire_store", productIds: [], oneUsePerCustomer: false, active: true,
    liveStreamId: STREAM, ...overrides,
  };
}

const cart = {
  sellerId: "seller-1", code: "LIVE15", customerKey: "buyer-1", cartSubtotalCents: 10_000,
  lines: [{ productId: "p1", priceCents: 10_000, quantity: 1 }],
};

beforeEach(() => {
  state.discountRow = liveCode();
  state.streamRow = { status: "live" };
  state.streamLookups = 0;
});
afterEach(() => vi.clearAllMocks());

describe("liveScopeRejection (pure)", () => {
  it("allows ordinary store codes everywhere", () => {
    expect(liveScopeRejection(null, null, null)).toBeNull();
    expect(liveScopeRejection(undefined, STREAM, "live")).toBeNull();
  });
  it("rejects a live code with no stream, or another stream", () => {
    expect(liveScopeRejection(STREAM, null, "live")?.code).toBe("LIVE_ONLY");
    expect(liveScopeRejection(STREAM, OTHER, "live")?.code).toBe("LIVE_ONLY");
  });
  it("rejects once the stream is no longer live", () => {
    expect(liveScopeRejection(STREAM, STREAM, "ended")?.code).toBe("LIVE_ENDED");
    expect(liveScopeRejection(STREAM, STREAM, null)?.code).toBe("LIVE_ENDED");
  });
  it("accepts the matching live stream while live (case-insensitive id)", () => {
    expect(liveScopeRejection(STREAM, STREAM.toUpperCase(), "live")).toBeNull();
  });
});

describe("validateDiscountCode with a live-only code", () => {
  it("applies during its own live", async () => {
    const r = await validateDiscountCode({ ...cart, liveStreamId: STREAM });
    expect(r.appliedAmountCents).toBe(1_500);
  });

  it("is rejected at checkout outside any live", async () => {
    await expect(validateDiscountCode(cart)).rejects.toMatchObject({ code: "LIVE_ONLY" });
    expect(state.streamLookups).toBe(0);
  });

  it("is rejected when checking out from a different live", async () => {
    await expect(validateDiscountCode({ ...cart, liveStreamId: OTHER })).rejects.toMatchObject({ code: "LIVE_ONLY" });
  });

  it("is rejected after the live ends", async () => {
    state.streamRow = { status: "ended" };
    await expect(validateDiscountCode({ ...cart, liveStreamId: STREAM })).rejects.toMatchObject({ code: "LIVE_ENDED" });
  });

  it("still enforces the normal rules (usage limit) inside the live", async () => {
    state.discountRow = liveCode({ maxUses: 2, usesCount: 2 });
    await expect(validateDiscountCode({ ...cart, liveStreamId: STREAM })).rejects.toMatchObject({ code: "MAX_USES_REACHED" });
  });

  it("leaves store codes untouched (no stream lookup, works with or without a live)", async () => {
    state.discountRow = liveCode({ liveStreamId: null });
    await expect(validateDiscountCode(cart)).resolves.toMatchObject({ appliedAmountCents: 1_500 });
    await expect(validateDiscountCode({ ...cart, liveStreamId: STREAM })).resolves.toMatchObject({ appliedAmountCents: 1_500 });
    expect(state.streamLookups).toBe(0);
  });
});

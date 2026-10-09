import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  recipient: undefined as Record<string, unknown> | undefined,
  tokenQueries: 0,
  promoColumnMissing: false,
}));

vi.mock("@workspace/db", () => {
  const usersTable = {
    accountType: "accountType",
    notificationPreferences: "prefs",
    pushEnabled: "pushEnabled",
    promoPushOptIn: "promoPushOptIn",
    quietHoursStart: "qs",
    quietHoursEnd: "qe",
    quietHoursTimezone: "qz",
    clerkId: "clerkId",
  };
  const pushTokensTable = { token: "token", userId: "userId", isActive: "isActive" };
  const db = {
    select: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => {
          const promoOnly = Object.keys(fields).length === 1 && "promoPushOptIn" in fields;
          if (promoOnly && state.promoColumnMissing) {
            const err = new Error('column "promo_push_opt_in" does not exist');
            return { then: (_res: unknown, rej: (e: Error) => void) => rej(err), limit: async () => { throw err; } };
          }
          const isTokens = table === pushTokensTable;
          if (isTokens) state.tokenQueries += 1;
          const result = isTokens ? [] : state.recipient ? [state.recipient] : [];
          // A delivered push only gets as far as the (empty) token lookup.
          return Object.assign(Promise.resolve(result), { limit: async () => result });
        },
      }),
    }),
  };
  return {
    db,
    users: usersTable,
    pushTokens: pushTokensTable,
    notificationDeliveries: {},
    notificationBatchQueue: {},
    notificationEvents: {},
  };
});

import { sendPushToUser } from "./push";
import { isPromotionalPush, promoConsentAllows } from "./pushPolicy";

const base = { accountType: "buyer", preferences: {}, pushEnabled: true, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: "UTC" };

beforeEach(() => {
  state.tokenQueries = 0;
  state.recipient = undefined;
  state.promoColumnMissing = false;
});

describe("promotional push classification", () => {
  it("classifies marketing types as promotional and orders/messages as transactional", () => {
    for (const type of ["drop_live", "new_product", "price_drop", "back_in_stock", "abandoned_cart"]) {
      expect(isPromotionalPush({ data: { type } })).toBe(true);
    }
    for (const type of ["order_confirmed", "new_order_received", "message", "payout_sent", "trial_ending", "post_like"]) {
      expect(isPromotionalPush({ data: { type } })).toBe(false);
    }
    expect(isPromotionalPush({ kind: "promotional", data: { type: "order_confirmed" } })).toBe(true);
    expect(isPromotionalPush({ kind: "transactional", data: { type: "drop_live" } })).toBe(false);
  });

  it("treats a missing or null opt-in as not opted in", () => {
    expect(promoConsentAllows({ data: { type: "drop_live" } }, undefined)).toBe(false);
    expect(promoConsentAllows({ data: { type: "drop_live" } }, { promoPushOptIn: null })).toBe(false);
    expect(promoConsentAllows({ data: { type: "drop_live" } }, { promoPushOptIn: true })).toBe(true);
    expect(promoConsentAllows({ data: { type: "order_confirmed" } }, { promoPushOptIn: false })).toBe(true);
  });
});

describe("sendPushToUser promotional chokepoint", () => {
  it("blocks promotional pushes when promo opt-in is off (default)", async () => {
    state.recipient = { ...base, promoPushOptIn: false };
    const sent = await sendPushToUser("u1", { title: "Drop is live!", body: "x", data: { type: "drop_live" } }, "drop");
    expect(sent).toBe(false);
    expect(state.tokenQueries).toBe(0);
  });

  it("blocks promotional pushes even when the transactional drop toggle is on", async () => {
    state.recipient = { ...base, preferences: { new_drops: true, price_alerts: true }, promoPushOptIn: false };
    await sendPushToUser("u1", { title: "Price drop", body: "x", data: { type: "price_drop" } }, "stock");
    await sendPushToUser("u1", { title: "New", body: "x", kind: "promotional" }, "drop");
    expect(state.tokenQueries).toBe(0);
  });

  it("allows promotional pushes after explicit opt-in (reaches token lookup)", async () => {
    state.recipient = { ...base, promoPushOptIn: true };
    await sendPushToUser("u1", { title: "Drop is live!", body: "x", data: { type: "drop_live" } }, "drop");
    expect(state.tokenQueries).toBe(1);
  });

  it("allows a per-drop explicit 'notify me' request without the global promo opt-in", async () => {
    state.recipient = { ...base, promoPushOptIn: false };
    await sendPushToUser("u1", { title: "Drop is live!", body: "x", data: { type: "drop_live" }, explicitRequest: true }, "drop");
    expect(state.tokenQueries).toBe(1);
  });

  it("never blocks transactional pushes when promo opt-in is off", async () => {
    state.recipient = { ...base, promoPushOptIn: false };
    for (const [type, cat] of [
      ["order_confirmed", "order"],
      ["message", "message"],
      ["payout_sent", "payout"],
      ["trial_ending", "subscription"],
    ] as const) {
      await sendPushToUser("u1", { title: "t", body: "b", data: { type } }, cat);
    }
    expect(state.tokenQueries).toBe(4);
  });

  it("still honours the master switch and category toggles for promo opt-ins", async () => {
    state.recipient = { ...base, promoPushOptIn: true, pushEnabled: false };
    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "drop_live" } }, "drop");
    state.recipient = { ...base, promoPushOptIn: true, preferences: { new_drops: false } };
    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "drop_live" } }, "drop");
    expect(state.tokenQueries).toBe(0);
  });

  it("missing promo column (migration 260 not applied): blocks promo, still sends transactional", async () => {
    state.promoColumnMissing = true;
    state.recipient = { ...base };
    const promo = await sendPushToUser("u1", { title: "t", body: "b", data: { type: "drop_live" } }, "drop");
    expect(promo).toBe(false);
    expect(state.tokenQueries).toBe(0);
    await sendPushToUser("u1", { title: "t", body: "b", data: { type: "order_confirmed" } }, "order");
    expect(state.tokenQueries).toBe(1);
  });
});

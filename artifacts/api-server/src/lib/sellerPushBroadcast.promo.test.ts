/**
 * QA-0148: a seller -> follower push broadcast is marketing, so it must only
 * reach followers who opted in to promotional notifications (App Store 4.5.4).
 */
import { describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("drizzle-orm", () => {
  const passthrough = (...args: unknown[]) => args;
  return { and: passthrough, desc: passthrough, eq: passthrough, sql: () => "" };
});
vi.mock("@workspace/db", () => {
  const chain: any = {
    select: () => chain, from: () => chain, where: () => chain, limit: async () => [{ displayName: "Atelier", username: "atelier" }],
    update: () => chain, set: () => chain,
    execute: async () => ({ rows: [{ id: "follower_1", ok: true }, { id: "follower_2", ok: true }] }),
    then: undefined,
  };
  chain.where = () => Object.assign(Promise.resolve([]), chain);
  return { db: chain, sellerPushBroadcasts: {}, users: {}, notificationEvents: {}, notificationsFeed: {} };
});
vi.mock("../routes/notifications-feed", () => ({
  publishNotification: vi.fn(async (n: Record<string, unknown>) => { published.push(n); }),
}));
vi.mock("./contentModerator", () => ({ evaluateContent: () => ({ action: "allow" }) }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { deliverBroadcast } from "./sellerPushBroadcast";
import { isPromotionalPush, promoConsentAllows } from "./pushPolicy";

describe("seller push broadcast consent (QA-0148)", () => {
  it("is classified as promotional by type alone", () => {
    expect(isPromotionalPush({ data: { type: "seller_broadcast" } })).toBe(true);
    expect(promoConsentAllows({ data: { type: "seller_broadcast" } }, { promoPushOptIn: false })).toBe(false);
    expect(promoConsentAllows({ data: { type: "seller_broadcast" } }, undefined)).toBe(false);
    expect(promoConsentAllows({ data: { type: "seller_broadcast" } }, { promoPushOptIn: true })).toBe(true);
  });

  it("publishes every broadcast as a promotional push", async () => {
    published.length = 0;
    await deliverBroadcast("claim_1", "seller_1", { title: "New drop", body: "Out now", deeplinkType: null, deeplinkId: null } as any);
    expect(published).toHaveLength(2);
    for (const n of published) {
      expect(n).toMatchObject({ type: "seller_broadcast", pushKind: "promotional" });
    }
  });
});

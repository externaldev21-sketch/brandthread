import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, liveActivityRemoteStarts: {}, liveActivityStartTokens: {} }));

import {
  ACTIVITY_MAX_ACTIVE_SECONDS,
  activitiesExpired,
  buildOrderActivityStartPayload,
  startOrderActivityRemotely,
  type RemoteStartDeps,
} from "../liveActivityRemoteStart";

const NOW = 1_800_000_000;
const shipped = { stage: "shipped" as const, statusText: "On its way with USPS", etaEpoch: NOW + 86_400 };

function deps(overrides: Partial<RemoteStartDeps> = {}) {
  const sent: Array<{ token: string; payload: unknown }> = [];
  const claimed = new Set<string>();
  const d: RemoteStartDeps = {
    claim: async (orderId, stage) => {
      const key = `${orderId}:${stage}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    startTokens: async () => ["aa", "bb"],
    send: async (token, payload) => { sent.push({ token, payload }); return { ok: true }; },
    ...overrides,
  };
  return { d, sent };
}

const input = { buyerId: "buyer_1", orderId: "o1", orderNumber: "BT-4821", sellerName: "Desires", state: shipped, nowSeconds: NOW };

describe("buildOrderActivityStartPayload", () => {
  it("matches the Swift OrderTrackingAttributes contract and starts silently", () => {
    expect(buildOrderActivityStartPayload(input)).toEqual({
      aps: {
        timestamp: NOW,
        event: "start",
        "content-state": shipped,
        "attributes-type": "OrderTrackingAttributes",
        attributes: { orderId: "o1", orderNumber: "BT-4821", sellerName: "Desires" },
        alert: { title: "Shipped", body: "On its way with USPS" },
      },
    });
    expect(JSON.stringify(buildOrderActivityStartPayload(input))).not.toContain("sound");
  });
});

describe("activitiesExpired", () => {
  it("is true with no tokens or only tokens past 8 hours", () => {
    expect(activitiesExpired([], NOW)).toBe(true);
    expect(activitiesExpired([new Date((NOW - ACTIVITY_MAX_ACTIVE_SECONDS) * 1000)], NOW)).toBe(true);
  });

  it("is false while any activity is younger, or a token has no timestamp", () => {
    expect(activitiesExpired([new Date((NOW - 9 * 3600) * 1000), new Date((NOW - 60) * 1000)], NOW)).toBe(false);
    expect(activitiesExpired([null], NOW)).toBe(false);
  });
});

describe("startOrderActivityRemotely", () => {
  it("sends to every push-to-start token of the buyer", async () => {
    const { d, sent } = deps();
    expect(await startOrderActivityRemotely(input, d)).toEqual({ started: 2, failed: 0 });
    expect(sent.map((s) => s.token)).toEqual(["aa", "bb"]);
  });

  it("starts at most once per order and stage", async () => {
    const { d, sent } = deps();
    await startOrderActivityRemotely(input, d);
    expect(await startOrderActivityRemotely(input, d)).toEqual({ skipped: "already_started" });
    expect(sent).toHaveLength(2);
    const out = { ...input, state: { stage: "out_for_delivery" as const, statusText: "Arriving today" } };
    expect(await startOrderActivityRemotely(out, d)).toEqual({ started: 2, failed: 0 });
  });

  it("never starts one just to say ordered or delivered", async () => {
    const { d, sent } = deps();
    for (const stage of ["ordered", "delivered"] as const) {
      expect(await startOrderActivityRemotely({ ...input, state: { stage, statusText: "x" } }, d)).toEqual({ skipped: "stage" });
    }
    expect(sent).toHaveLength(0);
  });

  it("doesn't claim the stage when the buyer has no start tokens", async () => {
    const claim = vi.fn(async () => true);
    const { d } = deps({ startTokens: async () => [], claim });
    expect(await startOrderActivityRemotely(input, d)).toEqual({ skipped: "no_start_tokens" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("counts failed sends", async () => {
    const { d } = deps({ send: async (token) => (token === "aa" ? { ok: true } : { skipped: "not_configured" }) });
    expect(await startOrderActivityRemotely(input, d)).toEqual({ started: 1, failed: 1 });
  });
});

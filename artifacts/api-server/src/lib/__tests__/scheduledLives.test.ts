/**
 * Reminder + went-live delivery for scheduled lives, with the database and the
 * notification publisher mocked: what matters here is who gets notified, with
 * what, and that a claim that returns no row sends nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queue: [] as Array<{ rows: any[] }>,
  queries: [] as string[],
  published: [] as any[],
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ text: strings.join("?"), exprs }),
}));
vi.mock("@workspace/db", () => ({
  db: {
    execute: async (q: { text: string }) => {
      h.queries.push(q.text);
      return h.queue.shift() ?? { rows: [] };
    },
  },
}));
vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async (n: any) => { h.published.push(n); },
}));
vi.mock("../logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { markScheduledLiveStarted, sendDueReminders } from "../scheduledLives";

const NOW = new Date("2026-10-01T12:00:00Z");
const scheduled = { id: "s1", seller_id: "seller-1", title: "Fall drop", starts_at: new Date(NOW.getTime() + 5 * 60_000) };

beforeEach(() => {
  h.queue = [];
  h.queries = [];
  h.published = [];
});

describe("sendDueReminders", () => {
  it("claims due lives and notifies every reminder subscriber once", async () => {
    h.queue = [
      { rows: [scheduled] },
      { rows: [{ user_id: "u1" }, { user_id: "u2" }] },
      { rows: [{ label: "Acme" }] },
    ];
    const n = await sendDueReminders(NOW);
    expect(n).toBe(1);
    expect(h.published.map((p) => p.userId)).toEqual(["u1", "u2"]);
    expect(h.published[0]).toMatchObject({
      type: "live_reminder", targetId: "s1", actorId: "seller-1", category: "drops",
    });
    expect(h.published[0].body).toContain("Fall drop starts in 5 minutes");
    // The claim is a single UPDATE ... RETURNING guarded by reminder_sent_at IS NULL.
    expect(h.queries[0]).toContain("reminder_sent_at IS NULL");
    expect(h.queries[0]).toContain("RETURNING");
  });

  it("sends nothing when no live is due (already claimed or not yet in window)", async () => {
    h.queue = [{ rows: [] }];
    expect(await sendDueReminders(NOW)).toBe(0);
    expect(h.published).toHaveLength(0);
  });
});

describe("markScheduledLiveStarted", () => {
  it("links the stream and notifies reminder subscribers with the stream as target", async () => {
    h.queue = [{ rows: [scheduled] }, { rows: [{ user_id: "u1" }] }, { rows: [{ label: "Acme" }] }];
    const ok = await markScheduledLiveStarted({ scheduledLiveId: "s1", sellerId: "seller-1", streamId: "stream-9", now: NOW });
    expect(ok).toBe(true);
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({ userId: "u1", type: "live_started", targetId: "stream-9", targetType: "live" });
    expect(h.queries[0]).toContain("seller_id =");
    expect(h.queries[0]).toContain("status = 'scheduled'");
  });

  it("does nothing for another seller's or an already-started entry", async () => {
    h.queue = [{ rows: [] }];
    const ok = await markScheduledLiveStarted({ scheduledLiveId: "s1", sellerId: "intruder", streamId: "stream-9", now: NOW });
    expect(ok).toBe(false);
    expect(h.published).toHaveLength(0);
  });
});

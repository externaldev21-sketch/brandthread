import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, liveCohosts, liveStreams, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.headers["x-test-user"];
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
}));
vi.mock("../live", () => ({ generateToken: () => "tok", uidFromClerkId: () => 42 }));
vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => undefined) }));
vi.mock("../../ws/liveHub", () => ({ broadcastToRoom: vi.fn() }));
// Simulates the race window: the pre-insert "already open?" check has passed
// for a request whose twin is inserting at the same moment.
const race = vi.hoisted(() => ({ skipCheck: false }));
vi.mock("../../lib/liveCohost", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/liveCohost")>();
  return { ...real, checkInviteAllowed: (i: any) => (race.skipCheck ? { ok: true } : real.checkInviteAllowed(i)) };
});

const sfx = crypto.randomBytes(5).toString("hex");
const HOST = `w1s06co-host-${sfx}`;
const CO = `w1s06co-co-${sfx}`;
let streamId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: HOST, email: `${HOST}@t.test`, name: "Host", accountType: "seller" },
    { clerkId: CO, email: `${CO}@t.test`, name: "Co", accountType: "seller" },
  ]);
  const [s] = await db.insert(liveStreams).values({ sellerId: HOST, channelName: `w1s06-${sfx}`, title: "t", status: "live" })
    .returning({ id: liveStreams.id });
  streamId = s.id;
  const { default: router } = await import("../live-cohost");
  const app = express();
  app.use(express.json());
  app.use("/api/live", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(liveCohosts).where(eq(liveCohosts.streamId, streamId));
  await db.delete(liveStreams).where(eq(liveStreams.id, streamId));
  await db.delete(users).where(inArray(users.clerkId, [HOST, CO]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/live/:id/cohost/invite concurrency", () => {
  it("lets exactly one of several concurrent invites win; the rest get 409, never a 500", async () => {
    const invite = () => fetch(`${base}/api/live/${streamId}/cohost/invite`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": HOST }, body: JSON.stringify({ userId: CO }),
    }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
    const results = await Promise.all(Array.from({ length: 6 }, invite));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    for (const r of results) expect(JSON.stringify(r.body)).not.toContain("duplicate key");
    const rows = await db.select().from(liveCohosts).where(eq(liveCohosts.streamId, streamId));
    expect(rows).toHaveLength(1);
  });

  it("answers 409 (not a 500 with the constraint name) when the open-invite unique index rejects the insert", async () => {
    race.skipCheck = true;
    try {
      const r = await fetch(`${base}/api/live/${streamId}/cohost/invite`, {
        method: "POST", headers: { "content-type": "application/json", "x-test-user": HOST }, body: JSON.stringify({ userId: CO }),
      });
      const text = await r.text();
      expect(r.status).toBe(409);
      expect(text).not.toContain("live_cohosts_open_unique");
    } finally {
      race.skipCheck = false;
    }
  });
});

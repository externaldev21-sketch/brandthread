import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, liveComments, liveStreams } from "@workspace/db";

vi.mock("../../lib/safety", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/safety")>()),
  optionalViewerId: () => null,
}));
vi.mock("../../ws/liveHub", () => ({ broadcastToRoom: vi.fn(), roomUserIds: () => [] }));

const sfx = crypto.randomBytes(5).toString("hex");
let streamId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  const [s] = await db.insert(liveStreams).values({ sellerId: `w1s06lc-${sfx}`, channelName: `w1s06lc-${sfx}`, title: "t", status: "live" })
    .returning({ id: liveStreams.id });
  streamId = s.id;
  await db.insert(liveComments).values({ streamId, userId: `w1s06lc-v-${sfx}`, displayName: "V", message: "hello" });
  const { default: router } = await import("../live");
  const app = express();
  app.use("/api/live", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await db.delete(liveComments).where(eq(liveComments.streamId, streamId));
  await db.delete(liveStreams).where(eq(liveStreams.id, streamId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/live/:id/comments?since=", () => {
  it("ignores a malformed since instead of a 500 timestamptz cast error", async () => {
    const res = await fetch(`${base}/api/live/${streamId}/comments?since=not-a-date`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.comments.map((c: any) => c.message)).toContain("hello");
  });

  it("still filters by a valid since", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await fetch(`${base}/api/live/${streamId}/comments?since=${encodeURIComponent(future)}`);
    expect(res.status).toBe(200);
    expect((await res.json() as any).comments).toEqual([]);
  });
});

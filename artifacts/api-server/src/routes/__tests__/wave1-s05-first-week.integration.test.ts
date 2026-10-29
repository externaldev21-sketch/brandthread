/**
 * Wave-1 audit (slice s05): the first-week Thread Cash reward passes the same
 * earn gate as every other reward (lib/threadCash/earnGate.ts). With rewards
 * paused (THREAD_CASH_EARN_ENABLED off) a finished checklist must not credit.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, firstWeekChecklist, pool, posts, products, threadCashEntries, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = req.header("x-test-user-id"); next(); },
}));

const sfx = crypto.randomBytes(5).toString("hex");
const sellerId = `fw-${sfx}-seller`;
let server: Server;
let base = "";
let previousFlag: boolean | null = null;
const previousEnv = process.env.THREAD_CASH_EARN_ENABLED;

beforeAll(async () => {
  delete process.env.THREAD_CASH_EARN_ENABLED;
  const prior = await pool.query<{ enabled: boolean }>("SELECT enabled FROM feature_flags WHERE key = 'firstWeekReward'");
  previousFlag = prior.rows[0]?.enabled ?? null;
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ('firstWeekReward', true, 'test')
     ON CONFLICT (key) DO UPDATE SET enabled = true`,
  );
  await db.insert(users).values({
    clerkId: sellerId, email: `${sellerId}@test.local`, name: "FW Seller", role: "seller", accountType: "seller",
    profileImageUrl: "https://example.test/logo.png",
  });
  await db.insert(products).values([1, 2, 3].map((n) => ({
    ownerId: sellerId, name: `FW product ${n}`, category: "apparel", status: "active",
  })));
  await db.insert(posts).values({ userId: sellerId, mediaUrl: "https://example.test/p.jpg" });
  await db.insert(firstWeekChecklist).values({ userId: sellerId, storeSharedAt: new Date(), updatedAt: new Date() });

  const { default: router } = await import("../first-week");
  const app = express();
  app.use(express.json());
  app.use("/api/first-week", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (previousEnv === undefined) delete process.env.THREAD_CASH_EARN_ENABLED;
  else process.env.THREAD_CASH_EARN_ENABLED = previousEnv;
  if (previousFlag === null) await pool.query("DELETE FROM feature_flags WHERE key = 'firstWeekReward'");
  else await pool.query("UPDATE feature_flags SET enabled = $1 WHERE key = 'firstWeekReward'", [previousFlag]);
  await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, sellerId));
  await db.delete(firstWeekChecklist).where(eq(firstWeekChecklist.userId, sellerId));
  await db.delete(posts).where(eq(posts.userId, sellerId));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [sellerId]));
});

describe("first-week reward and the earn gate", () => {
  it("does not credit Thread Cash while rewards are paused", async () => {
    const r = await fetch(`${base}/api/first-week`, { headers: { "x-test-user-id": sellerId } });
    const body = await r.json() as any;
    expect(r.status).toBe(200);
    expect(body.allDone).toBe(true);
    expect(body.reward).toEqual({ cents: 200, granted: false });
    const entries = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, sellerId));
    expect(entries).toHaveLength(0);
    const [state] = await db.select().from(firstWeekChecklist).where(eq(firstWeekChecklist.userId, sellerId));
    expect(state?.rewardGrantedAt ?? null).toBeNull();
  });
});

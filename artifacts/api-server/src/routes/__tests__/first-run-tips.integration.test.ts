/**
 * first_run_tips_seen / first_run_tips_settings (migration 110) — server-side
 * "seen" tracking for the <FirstRunTip> system.
 *
 * Covers:
 *  - GET /api/first-run-tips/seen starts empty for a brand-new account.
 *  - POST /:tipId/seen marks a tip seen, idempotently.
 *  - POST /skip-all persists the global suppression flag.
 *  - POST /reset ("Replay tips") clears seen tips AND skipAll.
 *  - Auth required; one account's state never leaks into another's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, firstRunTipsSeen, firstRunTipsSettings, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const userA = `first-run-tips-user-a-${suffix}`;
const userB = `first-run-tips-user-b-${suffix}`;

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: authState.clerkUserId }),
}));

let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: userA, email: `${userA}@test.local`, name: "Tips User A", displayName: "User A", role: "seller", accountType: "seller" },
    { clerkId: userB, email: `${userB}@test.local`, name: "Tips User B", displayName: "User B", role: "buyer", accountType: "buyer" },
  ]);

  const { default: firstRunTipsRouter } = await import("../first-run-tips");
  const app = express();
  app.use(express.json());
  app.use("/api/first-run-tips", firstRunTipsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(firstRunTipsSeen).where(inArray(firstRunTipsSeen.userId, [userA, userB]));
  await db.delete(firstRunTipsSettings).where(inArray(firstRunTipsSettings.userId, [userA, userB]));
  await db.delete(users).where(inArray(users.clerkId, [userA, userB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("first-run tips API", () => {
  it("401s with no auth", async () => {
    authState.clerkUserId = null;
    const response = await fetch(`${base}/api/first-run-tips/seen`);
    expect(response.status).toBe(401);
  });

  it("starts empty for a brand-new account", async () => {
    authState.clerkUserId = userA;
    const response = await fetch(`${base}/api/first-run-tips/seen`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body).toEqual({ seenTipIds: [], skipAll: false });
  });

  it("marks a tip seen, and marking the same tip again is a no-op", async () => {
    authState.clerkUserId = userA;
    const first = await fetch(`${base}/api/first-run-tips/seller-dashboard/seen`, { method: "POST" });
    expect(first.status).toBe(204);
    const second = await fetch(`${base}/api/first-run-tips/seller-dashboard/seen`, { method: "POST" });
    expect(second.status).toBe(204);

    const rows = await db.select().from(firstRunTipsSeen).where(eq(firstRunTipsSeen.userId, userA));
    expect(rows.filter((r) => r.tipId === "seller-dashboard").length).toBe(1);

    const getResponse = await fetch(`${base}/api/first-run-tips/seen`);
    const body = await getResponse.json() as any;
    expect(body.seenTipIds).toContain("seller-dashboard");
  });

  it("keeps each account's seen tips separate", async () => {
    authState.clerkUserId = userB;
    const response = await fetch(`${base}/api/first-run-tips/seen`);
    const body = await response.json() as any;
    expect(body.seenTipIds).not.toContain("seller-dashboard");
  });

  it("skip-all persists and is reflected on the next GET", async () => {
    authState.clerkUserId = userB;
    const post = await fetch(`${base}/api/first-run-tips/skip-all`, { method: "POST" });
    expect(post.status).toBe(204);

    const response = await fetch(`${base}/api/first-run-tips/seen`);
    const body = await response.json() as any;
    expect(body.skipAll).toBe(true);

    // Never leaks to the other account
    authState.clerkUserId = userA;
    const otherResponse = await fetch(`${base}/api/first-run-tips/seen`);
    const otherBody = await otherResponse.json() as any;
    expect(otherBody.skipAll).toBe(false);
  });

  it("reset (Replay tips) clears seen tips and skipAll for the account", async () => {
    authState.clerkUserId = userA;
    await fetch(`${base}/api/first-run-tips/mockup-to-model/seen`, { method: "POST" });
    await fetch(`${base}/api/first-run-tips/skip-all`, { method: "POST" });

    const before = await fetch(`${base}/api/first-run-tips/seen`);
    const beforeBody = await before.json() as any;
    expect(beforeBody.seenTipIds.length).toBeGreaterThan(0);
    expect(beforeBody.skipAll).toBe(true);

    const reset = await fetch(`${base}/api/first-run-tips/reset`, { method: "POST" });
    expect(reset.status).toBe(204);

    const after = await fetch(`${base}/api/first-run-tips/seen`);
    const afterBody = await after.json() as any;
    expect(afterBody).toEqual({ seenTipIds: [], skipAll: false });
  });
});

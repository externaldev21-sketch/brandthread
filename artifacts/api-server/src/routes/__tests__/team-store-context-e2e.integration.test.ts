/**
 * Team roles, end to end through the REAL API router (routes/index.ts), the
 * REAL requireAuth / teamContext / requireRole / requirePermission
 * middlewares and a real Postgres. Only Clerk's getAuth is stubbed (the
 * signed-in user id comes from a header), because this sandbox can't reach
 * Clerk.
 *
 * Covers the break where requireAuth (run again inside each router) reset
 * req.clerkUserId to the caller AFTER teamContext() had switched it to the
 * store owner — so a permitted manager's edits landed on their own empty
 * store — and the seller routers whose writes had no permission gate at all.
 *
 *   O  store owner (runs their own store)
 *   M  manager on O's store     K  marketing on O's store     V  viewer on O's store
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, liveComments, liveStreams, storefronts, teamMembers, users } from "@workspace/db";

// The full router imports the AI clients, which require their (unused here)
// configuration at import time.
vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key-not-used";
});

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: (req: any) => ({ userId: req.headers?.["x-test-user-id"] ?? null }),
  };
});
vi.mock("../../ws/auth", () => ({ verifyWsToken: async () => null }));

import apiRouter from "../index";

const suffix = crypto.randomUUID().slice(0, 8);
const O = `team-e2e-owner-${suffix}`;
const M = `team-e2e-manager-${suffix}`;
const K = `team-e2e-marketing-${suffix}`;
const V = `team-e2e-viewer-${suffix}`;
const ALL = [O, M, K, V];
let server: Server;
let base = "";
let streamId = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: O, email: `${O}@test.example`, name: "Owner", brandName: "Owner Studio", onboardingComplete: true },
    // Team members who don't run a store of their own default to the store
    // they joined (resolveTeamContext's documented default).
    { clerkId: M, email: `${M}@test.example`, name: "Manager", onboardingComplete: false },
    { clerkId: K, email: `${K}@test.example`, name: "Marketer", onboardingComplete: false },
    { clerkId: V, email: `${V}@test.example`, name: "Viewer", onboardingComplete: false },
  ]);
  await db.insert(teamMembers).values([
    { ownerId: O, memberClerkId: M, email: `${M}@test.example`, role: "manager", status: "active" },
    { ownerId: O, memberClerkId: K, email: `${K}@test.example`, role: "marketing", status: "active" },
    { ownerId: O, memberClerkId: V, email: `${V}@test.example`, role: "viewer", status: "active" },
  ]);
  streamId = crypto.randomUUID();
  await db.insert(liveStreams).values({ id: streamId, sellerId: O, channelName: `team-e2e-${streamId}`, title: "Owner live", status: "live" });

  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await db.delete(liveComments).where(eq(liveComments.streamId, streamId));
  await db.delete(liveStreams).where(eq(liveStreams.id, streamId));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, ALL));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, O));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("team member acting on the owner's store", () => {
  it("a manager's store edit lands on the OWNER's storefront, and the owner sees it", async () => {
    const ownerStore = await call("GET", "/store", O);
    expect(ownerStore.status).toBe(200);

    const saved = await call("PUT", "/store", M, { title: "Edited by manager" });
    expect(saved.status).toBe(200);

    const [ownerRow] = await db.select().from(storefronts).where(eq(storefronts.ownerId, O));
    expect(ownerRow.title).toBe("Edited by manager");
    // …and no stray storefront was created for the manager themself.
    const managerRows = await db.select().from(storefronts).where(eq(storefronts.ownerId, M));
    expect(managerRows).toHaveLength(0);

    const seenByOwner = await call("GET", "/store", O);
    expect(seenByOwner.body.title).toBe("Edited by manager");
  });

  it("a viewer can read the owner's store but cannot change it", async () => {
    const read = await call("GET", "/store", V);
    expect(read.status).toBe(200);
    expect(read.body.ownerId).toBe(O);

    const write = await call("PUT", "/store", V, { title: "Viewer edit" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("PERMISSION_REQUIRED");
    const [ownerRow] = await db.select().from(storefronts).where(eq(storefronts.ownerId, O));
    expect(ownerRow.title).toBe("Edited by manager");
  });

  it("writes on routers that had no gate now need the matching permission", async () => {
    // returns/disputes → orders; customers → customers; boosts → marketing.
    expect((await call("PATCH", `/returns/${crypto.randomUUID()}/status`, V, { status: "approved" })).status).toBe(403);
    expect((await call("POST", "/customers", V, { email: "x@test.example" })).status).toBe(403);
    expect((await call("POST", "/disputes/x/accept", K, {})).status).toBe(403);
    expect((await call("POST", "/boosts", V, {})).status).toBe(403);
    expect((await call("POST", "/store/publish", K, {})).status).toBe(403);
  });

  it("marketing members no longer pass staff-ranked order gates", async () => {
    const res = await call("PATCH", `/orders/${crypto.randomUUID()}/status`, K, { status: "shipped" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ROLE_REQUIRED");
  });

  it("a buyer-side action by a team member stays theirs, not the owner's", async () => {
    const res = await call("POST", `/live/${streamId}/comment`, V, { message: "Love this drop" });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(liveComments).where(eq(liveComments.streamId, streamId));
    expect(row.userId).toBe(V);
  });

  it("the owner keeps full access to their own store", async () => {
    const res = await call("PUT", "/store", O, { title: "Owner title" });
    expect(res.status).toBe(200);
    expect(res.body.title ?? (await call("GET", "/store", O)).body.title).toBe("Owner title");
  });
});

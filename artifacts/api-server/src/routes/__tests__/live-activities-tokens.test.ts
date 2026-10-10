/**
 * POST/DELETE /api/live-activities/tokens — validation and ownership checks
 * for iOS Live Activity push-token registration. The db is mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  order: null as null | { buyerId: string | null },
  stream: null as null | { sellerId: string },
  inserts: [] as Array<{ values: unknown; conflictSet: unknown }>,
  updates: [] as Array<{ values: unknown; where: unknown }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...values: unknown[]) => ({ eq: values }),
  and: (...values: unknown[]) => ({ and: values }),
}));

vi.mock("@workspace/db", () => {
  const orders = { id: "orders.id", buyerId: "orders.buyerId" };
  const liveStreams = { id: "liveStreams.id", sellerId: "liveStreams.sellerId" };
  const liveActivityTokens = { token: "lat.token", userId: "lat.userId" };
  return {
    orders,
    liveStreams,
    liveActivityTokens,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === orders) return state.order ? [state.order] : [];
              if (table === liveStreams) return state.stream ? [state.stream] : [];
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (values: unknown) => ({
          onConflictDoUpdate: async (opts: { set: unknown }) => {
            state.inserts.push({ values, conflictSet: opts.set });
          },
        }),
      }),
      update: () => ({
        set: (values: unknown) => ({
          where: async (where: unknown) => { state.updates.push({ values, where }); },
        }),
      }),
    },
  };
});

import liveActivitiesRouter from "../liveActivities";

const ORDER_ID = "6f1c1f9e-0b8e-4c39-9a52-3a1f2b9d8c11";
const STREAM_ID = "0d6a7f9b-2b3c-4d5e-8f90-1a2b3c4d5e6f";
const TOKEN = "a1b2c3d4".repeat(8);

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/live-activities", liveActivitiesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.order = null;
  state.stream = null;
  state.inserts = [];
  state.updates = [];
});

function register(body: unknown, user: string | null = "buyer-1") {
  return fetch(`${baseUrl}/api/live-activities/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/live-activities/tokens", () => {
  it("requires auth", async () => {
    const res = await register({ kind: "order", targetId: ORDER_ID, token: TOKEN }, null);
    expect(res.status).toBe(401);
  });

  it.each([
    [{}],
    [{ kind: "drop", targetId: ORDER_ID, token: TOKEN }],
    [{ kind: "order", targetId: "not-a-uuid", token: TOKEN }],
    [{ kind: "order", targetId: ORDER_ID, token: "zz-not-hex" }],
    [{ kind: "order", targetId: ORDER_ID, token: "abcd" }],
    [{ kind: "order", targetId: ORDER_ID, token: TOKEN, extra: true }],
  ])("rejects an invalid body %#", async (body) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(state.inserts).toHaveLength(0);
  });

  it("registers a token for the caller's own order", async () => {
    state.order = { buyerId: "buyer-1" };
    const res = await register({ kind: "order", targetId: ORDER_ID, token: TOKEN.toUpperCase() });
    expect(res.status).toBe(200);
    expect(state.inserts).toEqual([{
      values: { userId: "buyer-1", kind: "order", targetId: ORDER_ID, token: TOKEN },
      conflictSet: expect.objectContaining({ userId: "buyer-1", kind: "order", targetId: ORDER_ID, active: true }),
    }]);
  });

  it("refuses someone else's order, or one that doesn't exist", async () => {
    state.order = { buyerId: "buyer-2" };
    expect((await register({ kind: "order", targetId: ORDER_ID, token: TOKEN })).status).toBe(404);
    state.order = { buyerId: null };
    expect((await register({ kind: "order", targetId: ORDER_ID, token: TOKEN })).status).toBe(404);
    state.order = null;
    expect((await register({ kind: "order", targetId: ORDER_ID, token: TOKEN })).status).toBe(404);
    expect(state.inserts).toHaveLength(0);
  });

  it("registers a live token only for the stream's seller", async () => {
    state.stream = { sellerId: "seller-1" };
    expect((await register({ kind: "live", targetId: STREAM_ID, token: TOKEN }, "viewer-9")).status).toBe(404);
    expect(state.inserts).toHaveLength(0);
    expect((await register({ kind: "live", targetId: STREAM_ID, token: TOKEN }, "seller-1")).status).toBe(200);
    expect(state.inserts[0].values).toMatchObject({ userId: "seller-1", kind: "live", targetId: STREAM_ID });
  });
});

describe("DELETE /api/live-activities/tokens/:token", () => {
  it("deactivates only the caller's token", async () => {
    const res = await fetch(`${baseUrl}/api/live-activities/tokens/${TOKEN}`, {
      method: "DELETE", headers: { "x-test-user": "buyer-1" },
    });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toMatchObject({ active: false });
    expect(state.updates[0].where).toEqual({
      and: [{ eq: ["lat.token", TOKEN] }, { eq: ["lat.userId", "buyer-1"] }],
    });
  });

  it("rejects a malformed token and requires auth", async () => {
    expect((await fetch(`${baseUrl}/api/live-activities/tokens/nope`, {
      method: "DELETE", headers: { "x-test-user": "buyer-1" },
    })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/live-activities/tokens/${TOKEN}`, { method: "DELETE" })).status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });
});

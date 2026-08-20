/**
 * Regression coverage for billing isolation in a joined-store context.
 *
 * teamContext deliberately rewrites clerkUserId to the joined store's owner so
 * normal seller-scoped queries use that store. requireRole must still make its
 * decision from actorRole, not the rewritten clerkUserId.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testState = vi.hoisted(() => ({
  actorRole: "staff",
  actorId: "team-member-clerk-id",
  ownerId: "joined-store-owner-clerk-id",
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: testState.actorId }),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const membershipQuery = {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [{
            id: "team-membership-id",
            ownerId: testState.ownerId,
            role: testState.actorRole,
          }],
        }),
      }),
    }),
  };

  return {
    db: {
      select: () => membershipQuery,
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    },
    teamMembers: columns,
    users: columns,
  };
});

import { requireRole, teamContext } from "../../middlewares/requireRole";
import connectRouter from "../connect";
import financeRouter from "../finance";
import subscriptionRouter from "../subscription";

let server: Server;
let base = "";

async function request(path: string, method = "GET") {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

beforeAll(async () => {
  const app = express();

  // Mirrors the application mounts: Connect has the owner gate at its parent
  // mount, while subscription and finance enforce it inside their routers.
  app.use("/api/seller/connect", requireRole("owner"), connectRouter);
  app.use("/api/seller/subscription", subscriptionRouter);
  app.use("/api/finance", financeRouter);

  // This endpoint confirms the store rewrite and preserved actor role together.
  app.get("/context-proof", teamContext(), requireRole("staff"), (req, res) => {
    res.json({
      actingStoreOwner: (req as any).clerkUserId,
      actorRole: (req as any).actorRole,
    });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("joined-store billing isolation", () => {
  it.each(["staff", "manager"])(
    "rejects a %s member from every billing surface after owner rewrite",
    async (role) => {
      testState.actorRole = role;

      const context = await request("/context-proof");
      expect(context.status).toBe(200);
      expect(context.body).toEqual({
        actingStoreOwner: testState.ownerId,
        actorRole: role,
      });

      for (const [method, path] of [
        ["GET", "/api/seller/subscription/status"],
        ["GET", "/api/seller/subscription/invoices"],
        ["POST", "/api/seller/subscription/checkout"],
        ["POST", "/api/seller/subscription/portal"],
        ["GET", "/api/seller/connect/status"],
        ["POST", "/api/seller/connect/onboard"],
        ["GET", "/api/seller/connect/onboard/return"],
        ["GET", "/api/seller/connect/onboard/refresh"],
        ["GET", "/api/finance/balance"],
        ["GET", "/api/finance/payouts"],
        ["GET", "/api/finance/transactions"],
        ["GET", "/api/finance/statement.csv"],
        ["POST", "/api/finance/payout"],
      ]) {
        const result = await request(path, method);
        expect(result.status).toBe(403);
        expect(result.body).toMatchObject({
          code: "ROLE_REQUIRED",
          requiredRole: "owner",
          currentRole: role,
        });
      }
    },
  );
});
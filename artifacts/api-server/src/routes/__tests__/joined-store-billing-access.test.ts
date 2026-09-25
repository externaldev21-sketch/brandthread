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
  asc: (value: unknown) => value,
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
  // This actor is purely a joined team member with no store of their own
  // (unlike the real store owner covered in own-store-context-default.test.ts),
  // so the default-context lookup should keep resolving to the joined store.
  const onboardingQuery = {
    from: () => ({
      where: () => ({
        limit: async () => [{ onboardingComplete: false }],
      }),
    }),
  };

  return {
    db: {
      select: (fields: Record<string, unknown> | undefined) =>
        fields && Object.prototype.hasOwnProperty.call(fields, "onboardingComplete")
          ? onboardingQuery
          : membershipQuery,
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
    "rejects a %s member from every subscription/connect/money-moving surface after owner rewrite",
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
        // Money-moving: still owner-only regardless of finance read access.
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

  it("rejects staff (but not manager) from read-only finance data after owner rewrite", async () => {
    testState.actorRole = "staff";

    for (const path of [
      "/api/finance/balance",
      "/api/finance/payouts",
      "/api/finance/transactions",
      "/api/finance/statement.csv",
    ]) {
      const result = await request(path);
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({
        code: "ROLE_REQUIRED",
        requiredRole: "manager",
        currentRole: "staff",
      });
    }
  });

  it("lets a manager team member read finance data for the store they joined (the legitimate finance-related role)", async () => {
    testState.actorRole = "manager";

    for (const path of [
      "/api/finance/balance",
      "/api/finance/payouts",
      "/api/finance/transactions",
      "/api/finance/statement.csv",
    ]) {
      const response = await fetch(`${base}${path}`);
      // These fakes don't stub Stripe/DB deep enough to return 200s, but the
      // point of this test is that the role gate itself lets a manager
      // through (no 403/ROLE_REQUIRED) — same as any other manager-gated
      // read elsewhere in the app.
      expect(response.status, `${path} -> ${await response.clone().text()}`).not.toBe(403);
    }
  });
});
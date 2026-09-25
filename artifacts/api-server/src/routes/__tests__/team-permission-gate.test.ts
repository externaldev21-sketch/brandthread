/**
 * Regression coverage for the new capability-based team roles (admin, finance,
 * orders, marketing, viewer) introduced alongside the legacy owner/manager/
 * staff hierarchy. `requirePermission()` (middlewares/requireRole.ts) is what
 * finance.ts and discount-codes.ts now gate on instead of `requireRole("owner")`,
 * so a "finance" member gets payouts access and a "viewer" is blocked from
 * mutating anything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { vi } from "vitest";

const state = vi.hoisted(() => ({
  actorRole: "viewer",
  actorId: "team-member-clerk-id",
  ownerId: "store-owner-clerk-id",
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.actorId }),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  sql: (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ strings, exprs }),
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  const membershipQuery = {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [{
            id: "team-membership-id",
            ownerId: state.ownerId,
            role: state.actorRole,
          }],
        }),
        limit: async () => [],
      }),
    }),
  };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => [{ id: "team-membership-id", ownerId: state.ownerId, role: state.actorRole }] }),
            limit: async () => [],
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: "code-1" }] }) }),
    },
    teamMembers: columns,
    discountCodes: columns,
    products: columns,
  };
});

import { teamContext, requirePermission } from "../../middlewares/requireRole";

let server: Server;
let base = "";

async function request(path: string, method: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeAll(async () => {
  const { default: discountCodesRouter } = await import("../discount-codes");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/discount-codes", teamContext(), discountCodesRouter);
  // A stub payouts-shaped route, gated the same way finance.ts gates its real
  // routes (requirePermission("payouts") instead of requireRole("owner")).
  app.get("/api/finance/balance", teamContext(), requirePermission("payouts"), (_req, res) => {
    res.json({ ok: true });
  });
  app.use((err: any, _req: any, res: any, _next: any) => {
    // Surface the real error during test runs instead of Express's default 500 HTML page.
    // eslint-disable-next-line no-console
    console.error("TEST ROUTE ERROR", err);
    res.status(500).json({ error: String(err?.message ?? err) });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("discount-codes.ts requires the marketing permission for mutations", () => {
  it("blocks a viewer from creating a discount code", async () => {
    state.actorRole = "viewer";
    const result = await request("/api/discount-codes", "POST", {
      code: "SAVE10", type: "percentage", value: 10,
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "PERMISSION_REQUIRED", requiredPermission: "marketing" });
  });

  it("blocks an orders-role member from creating a discount code", async () => {
    state.actorRole = "orders";
    const result = await request("/api/discount-codes", "POST", {
      code: "SAVE10", type: "percentage", value: 10,
    });
    expect(result.status).toBe(403);
  });

  it("allows a marketing-role member to create a discount code", async () => {
    state.actorRole = "marketing";
    const result = await request("/api/discount-codes", "POST", {
      code: "SAVE10", type: "percentage", value: 10,
    });
    expect(result.status).toBe(201);
  });

  it("allows an admin to create a discount code", async () => {
    state.actorRole = "admin";
    const result = await request("/api/discount-codes", "POST", {
      code: "SAVE10", type: "percentage", value: 10,
    });
    expect(result.status).toBe(201);
  });
});

describe("finance.ts payouts routes grant access via requirePermission(\"payouts\")", () => {
  it("grants a finance-role member payouts access", async () => {
    state.actorRole = "finance";
    const result = await request("/api/finance/balance", "GET");
    expect(result.status).toBe(200);
  });

  it("grants an admin payouts access", async () => {
    state.actorRole = "admin";
    const result = await request("/api/finance/balance", "GET");
    expect(result.status).toBe(200);
  });

  it("blocks a marketing-role member from payouts", async () => {
    state.actorRole = "marketing";
    const result = await request("/api/finance/balance", "GET");
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "PERMISSION_REQUIRED", requiredPermission: "payouts" });
  });

  it("blocks a viewer from payouts", async () => {
    state.actorRole = "viewer";
    const result = await request("/api/finance/balance", "GET");
    expect(result.status).toBe(403);
  });
});

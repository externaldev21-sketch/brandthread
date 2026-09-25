/**
 * Regression coverage: drops.ts money-moving mutations (create, edit, cancel
 * preorders with buyer refunds, broadcast) previously only required
 * `requireAuth`, so ANY active team member — including the lowest "staff"
 * tier, whose permissions are documented as "orders:read, orders:fulfill"
 * only — could create/edit drops and trigger buyer refunds via
 * cancel-preorders. These routes must require at least the "manager" role,
 * mirroring products.ts / inventory.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  actorRole: "staff",
  actorId: "team-member-clerk-id",
  ownerId: "joined-store-owner-clerk-id",
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.actorId }),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
  notExists: (value: unknown) => value,
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
      }),
    }),
  };
  // This actor is purely a joined team member with no store of their own, so
  // the default-context lookup should keep resolving to the joined store.
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
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    teamMembers: columns,
    drops: columns,
    orders: columns,
    customers: columns,
    follows: columns,
    dropAlertSubscriptions: columns,
    dropBroadcasts: columns,
    users: columns,
  };
});

import { teamContext } from "../../middlewares/requireRole";

let server: Server;
let base = "";

async function request(path: string, method: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify({}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeAll(async () => {
  const { default: dropsRouter } = await import("../drops");
  const app = express();
  app.use(express.json());
  // Mirrors the production mount in routes/index.ts: teamContext runs ahead
  // of the router so X-Store-Context / joined-store rewriting is honoured.
  app.use("/api/drops", teamContext(), dropsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("drops.ts requires manager+ for money-moving mutations", () => {
  it("rejects a staff team member from creating, editing, cancelling, and broadcasting drops", async () => {
    state.actorRole = "staff";

    for (const [method, path] of [
      ["POST", "/api/drops"],
      ["PATCH", "/api/drops/00000000-0000-4000-8000-000000000000"],
      ["POST", "/api/drops/00000000-0000-4000-8000-000000000000/cancel-preorders"],
      ["POST", "/api/drops/00000000-0000-4000-8000-000000000000/broadcast"],
    ] as const) {
      const result = await request(path, method);
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({
        code: "ROLE_REQUIRED",
        requiredRole: "manager",
        currentRole: "staff",
      });
    }
  });
});

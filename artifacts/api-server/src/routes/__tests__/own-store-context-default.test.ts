/**
 * Regression coverage for the Payouts access bug: a real store owner who has
 * ALSO joined someone else's store as staff/manager must still act as the
 * OWNER of their own store by default (no explicit x-store-context header),
 * instead of being silently switched into the other store and locked out of
 * their own owner-only screens (Payouts, Finance, Subscription).
 *
 * Root cause: `resolveTeamContext` treated an absent header exactly like an
 * explicit "joined" request and always preferred the newest active team
 * membership. The fix defaults to the caller's own store whenever they
 * actually run one (users.onboardingComplete), and only keeps the legacy
 * "joined" default for callers who are purely team members with no store of
 * their own.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  callerId: "caller-clerk-id",
  onboardingComplete: true,
  membership: null as null | { id: string; ownerId: string; role: string },
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.callerId }),
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
  return {
    db: {
      select: (fields: Record<string, unknown> | undefined) => {
        const wantsOnboarding = Boolean(fields && Object.prototype.hasOwnProperty.call(fields, "onboardingComplete"));
        if (wantsOnboarding) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ onboardingComplete: state.onboardingComplete }],
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => (state.membership ? [state.membership] : []),
              }),
            }),
          }),
        };
      },
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    teamMembers: columns,
    users: columns,
  };
});

import { requireRole, teamContext } from "../../middlewares/requireRole";

let server: Server;
let base = "";

async function request(path: string) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const app = express();
  app.get("/whoami", teamContext(), requireRole("staff"), (req, res) => {
    res.json({
      storeOwner: (req as any).clerkUserId,
      role: (req as any).actorRole,
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

beforeEach(() => {
  state.callerId = "caller-clerk-id";
  state.onboardingComplete = true;
  state.membership = { id: "membership-1", ownerId: "other-store-owner", role: "manager" };
});

describe("default store context resolution", () => {
  it("keeps a real store owner acting on their OWN store by default, even with an active membership elsewhere", async () => {
    const result = await request("/whoami");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ storeOwner: state.callerId, role: "owner" });
  });

  it("still honors an explicit 'joined' or membership-id selection for that same owner", async () => {
    const joined = await fetch(`${base}/whoami`, { headers: { "x-store-context": "joined" } });
    expect(await joined.json()).toEqual({ storeOwner: "other-store-owner", role: "manager" });

    const byId = await fetch(`${base}/whoami`, { headers: { "x-store-context": "membership-1" } });
    expect(await byId.json()).toEqual({ storeOwner: "other-store-owner", role: "manager" });
  });

  it("falls back to the legacy joined-store default for a caller with no store of their own", async () => {
    state.onboardingComplete = false;

    const result = await request("/whoami");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ storeOwner: "other-store-owner", role: "manager" });
  });

  it("still defaults to the caller's own (empty) store when they have no membership anywhere", async () => {
    state.membership = null;

    const result = await request("/whoami");

    expect(result.body).toEqual({ storeOwner: state.callerId, role: "owner" });
  });
});

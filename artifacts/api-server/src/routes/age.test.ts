import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const h = vi.hoisted(() => ({
  stored: null as string | null,
  userExists: true,
  setPayloads: [] as Array<Record<string, unknown>>,
  revoked: [] as string[],
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "user_1";
    next();
  },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    sessions: {
      getSessionList: async () => ({ data: [{ id: "s1" }, { id: "s2" }] }),
      revokeSession: async (id: string) => { h.revoked.push(id); },
    },
  },
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, isNull: (...a: unknown[]) => a };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.userExists ? [{ ageBand: h.stored }] : []),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => {
        h.setPayloads.push(payload);
        return {
          where: () => ({
            returning: async () => {
              if (h.stored) return [];
              h.stored = payload.ageBand as string;
              return [{ ageBand: payload.ageBand }];
            },
          }),
        };
      },
    }),
  },
  users: { ageBand: "age_band", clerkId: "clerk_id" },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: router } = await import("./age");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  h.stored = null;
  h.userExists = true;
  h.setPayloads = [];
  h.revoked = [];
});

async function post(dateOfBirth: unknown) {
  const res = await fetch(`${base}/api/auth/age`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateOfBirth }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function yearsAgo(n: number, dayOffset = -10) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

describe("POST /api/auth/age", () => {
  it("stores only the band and never a date of birth", async () => {
    const dob = yearsAgo(25);
    const r = await post(dob);
    expect(r).toEqual({ status: 200, body: { ageBand: "18_plus" } });
    expect(h.setPayloads).toHaveLength(1);
    const payload = h.setPayloads[0]!;
    expect(Object.keys(payload).sort()).toEqual(["ageBand", "ageVerifiedAt", "updatedAt"]);
    expect(JSON.stringify(payload)).not.toContain(dob);
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/dob|birth/);
  });

  it("returns 13_17 for a 15 year old", async () => {
    expect((await post(yearsAgo(15))).body).toEqual({ ageBand: "13_17" });
  });

  it("blocks under 13: 403 AGE_UNDER_13, flags the account, revokes sessions, stores no DOB", async () => {
    const dob = yearsAgo(10);
    const r = await post(dob);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("AGE_UNDER_13");
    const payload = h.setPayloads[0]!;
    expect(payload.ageBand).toBe("under_13");
    expect(payload.underageBlockedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(payload)).not.toContain(dob);
    expect(h.revoked).toEqual(["s1", "s2"]);
    // Re-trying with an adult DOB cannot undo the block.
    const retry = await post(yearsAgo(30));
    expect(retry.status).toBe(403);
    expect(retry.body.code).toBe("AGE_UNDER_13");
    expect(h.setPayloads).toHaveLength(1);
  });

  it("is immutable: no self-upgrade to a higher band", async () => {
    h.stored = "13_17";
    const r = await post(yearsAgo(40));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "AGE_BAND_LOCKED", ageBand: "13_17" });
    expect(h.setPayloads).toHaveLength(0);
  });

  it("is idempotent when the same band is re-submitted", async () => {
    h.stored = "18_plus";
    expect(await post(yearsAgo(40))).toEqual({ status: 200, body: { ageBand: "18_plus" } });
    expect(h.setPayloads).toHaveLength(0);
  });

  it("rejects invalid, future and implausible dates", async () => {
    for (const bad of ["nope", "2011-02-30", "2999-01-01", "1800-01-01", ""]) {
      const r = await post(bad);
      expect(r.status).toBe(400);
    }
    expect(h.setPayloads).toHaveLength(0);
  });

  it("404s when the user has not been synced", async () => {
    h.userExists = false;
    expect((await post(yearsAgo(20))).status).toBe(404);
  });
});

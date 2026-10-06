/**
 * QA-0076: a discount's end date must be after its start date. The seller app
 * now sends the start as the start of the local day and the end as the end
 * of the local day, but the server must still reject an inverted / invalid
 * window with a 400 rather than storing a code that can never be redeemed
 * (or 500-ing on an Invalid Date).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  inserted: [] as unknown[],
  updated: [] as unknown[],
  existing: { startsAt: null as Date | null, expiresAt: null as Date | null },
  hasExisting: false,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = "seller-1";
    req.log = { error: () => {} };
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/discounts", () => ({
  validateDiscountCode: async () => ({}),
  DiscountValidationError: class extends Error {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...v: unknown[]) => v,
  inArray: (...v: unknown[]) => v,
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  const selectChain = () => ({
    from: () => ({
      where: () => ({
        // POST's code-collision lookup must find no clash; PATCH's
        // existing-row lookup returns the stored window.
        limit: async () => (state.hasExisting ? [state.existing] : []),
      }),
    }),
  });
  return {
    db: {
      select: selectChain,
      insert: () => ({
        values: (v: any) => {
          state.inserted.push(v);
          return { returning: async () => [{ ...v }] };
        },
      }),
      update: () => ({
        set: (v: any) => {
          state.updated.push(v);
          return { where: () => ({ returning: async () => [{ id: "d1", active: true, ...state.existing, ...v }] }) };
        },
      }),
    },
    discountCodes: columns,
    discountCodeUses: columns,
    products: columns,
  };
});

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: router } = await import("../discount-codes");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  state.inserted = [];
  state.updated = [];
  state.existing = { startsAt: null, expiresAt: null };
  state.hasExisting = false;
});

const send = (method: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("discountDateWindowError", () => {
  it("accepts open-ended and well-ordered windows", async () => {
    const { discountDateWindowError } = await import("../discount-codes");
    expect(discountDateWindowError(null, null)).toBeNull();
    expect(discountDateWindowError(undefined, "2026-12-01T07:59:59.999Z")).toBeNull();
    expect(discountDateWindowError("2026-12-01T08:00:00.000Z", "2026-12-02T07:59:59.999Z")).toBeNull();
  });

  it("rejects end <= start and invalid dates", async () => {
    const { discountDateWindowError } = await import("../discount-codes");
    expect(discountDateWindowError("2026-12-10T00:00:00.000Z", "2026-12-01T00:00:00.000Z")).toMatch(/after startsAt/);
    expect(discountDateWindowError("2026-12-10T00:00:00.000Z", "2026-12-10T00:00:00.000Z")).toMatch(/after startsAt/);
    expect(discountDateWindowError("abc", null)).toMatch(/startsAt must be a valid date/);
    expect(discountDateWindowError(null, "next friday")).toMatch(/expiresAt must be a valid date/);
  });
});

describe("POST / date window", () => {
  it("400s when expiresAt is before startsAt and inserts nothing", async () => {
    const res = await send("POST", "/", {
      type: "percentage", value: 20,
      startsAt: "2026-12-10T08:00:00.000Z", expiresAt: "2026-12-02T07:59:59.999Z",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("expiresAt must be after startsAt");
    expect(state.inserted).toHaveLength(0);
  });

  it("creates the code when the window is valid", async () => {
    const res = await send("POST", "/", {
      type: "percentage", value: 20, code: "SAVE20",
      startsAt: "2026-12-01T08:00:00.000Z", expiresAt: "2026-12-02T07:59:59.999Z",
    });
    expect(res.status).toBe(201);
    expect(state.inserted).toHaveLength(1);
  });
});

describe("PATCH /:id date window", () => {
  it("400s when only expiresAt changes to before the stored startsAt", async () => {
    state.hasExisting = true;
    state.existing = { startsAt: new Date("2026-12-10T08:00:00.000Z"), expiresAt: null };
    const res = await send("PATCH", "/d1", { expiresAt: "2026-12-05T07:59:59.999Z" });
    expect(res.status).toBe(400);
    expect(state.updated).toHaveLength(0);
  });

  it("allows a pause toggle without touching dates", async () => {
    state.hasExisting = true;
    state.existing = { startsAt: new Date("2026-12-10T08:00:00.000Z"), expiresAt: new Date("2026-12-01T00:00:00.000Z") };
    const res = await send("PATCH", "/d1", { active: false });
    expect(res.status).toBe(200);
    expect(state.updated).toHaveLength(1);
  });
});

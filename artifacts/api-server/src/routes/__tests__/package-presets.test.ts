/**
 * Regression coverage: the package-presets router (saved box sizes used by
 * the fulfillment wizard and Shipping screen) was imported in routes/index.ts
 * but never mounted, so every GET/POST/PATCH/DELETE /api/package-presets call
 * 404'd and "Save preset" always failed in the mobile app.
 *
 * DB-free: the db, auth and team-context middlewares are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  ownerId: "store-owner-clerk-id",
  inserted: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.ownerId;
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  desc: (value: unknown) => value,
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    sellerPackagePresets: columns,
    db: {
      select: () => ({
        from: () => ({ where: () => ({ orderBy: async () => state.rows }) }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          state.inserted.push(values);
          return { returning: async () => [{ id: "7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a", ...values }] };
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ id: "7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a", ...values }] }),
        }),
      }),
      delete: () => ({
        where: () => ({ returning: async () => [{ id: "7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a" }] }),
      }),
    },
  };
});

let server: Server;
let base = "";

async function request(pathName: string, method: string, body?: unknown) {
  const response = await fetch(`${base}${pathName}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const { default: packagePresetsRouter } = await import("../package-presets");
  const app = express();
  app.use(express.json());
  app.use("/api/package-presets", packagePresetsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.inserted = [];
  state.rows = [];
});

describe("package presets route", () => {
  it("is mounted at /package-presets in routes/index.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "..", "index.ts"), "utf8");
    expect(source).toMatch(/router\.use\(\s*["']\/package-presets["']\s*,[^)]*packagePresetsRouter\s*\)/);
  });

  it("lists presets in the { presets } shape the mobile client reads", async () => {
    state.rows = [{ id: "a", name: "Small box", weightOz: 8, lengthIn: "6.00", widthIn: "4.00", heightIn: "2.00" }];
    const res = await request("/api/package-presets", "GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ presets: state.rows });
  });

  it("creates a preset for the store owner and returns { preset }", async () => {
    const res = await request("/api/package-presets", "POST", {
      name: " Small box ", weightOz: 8.4, lengthIn: 6, widthIn: 4, heightIn: 2,
    });
    expect(res.status).toBe(201);
    expect(state.inserted).toEqual([{
      ownerId: state.ownerId, name: "Small box", weightOz: 8, lengthIn: "6.00", widthIn: "4.00", heightIn: "2.00",
    }]);
    expect(res.body.preset).toMatchObject({ id: "7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a", name: "Small box" });
  });

  it("rejects invalid input with a readable error instead of saving", async () => {
    const res = await request("/api/package-presets", "POST", { name: "Box", weightOz: 0, lengthIn: 1, widthIn: 1, heightIn: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weightOz/);
    expect(state.inserted).toHaveLength(0);
  });

  it("updates and deletes a preset", async () => {
    const patched = await request("/api/package-presets/7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a", "PATCH", { name: "Big box", heightIn: 10 });
    expect(patched.status).toBe(200);
    expect(patched.body.preset).toMatchObject({ name: "Big box", heightIn: "10.00" });

    const removed = await request("/api/package-presets/7c1e2a4b-0d3f-4e5a-9b6c-1f2e3d4c5b6a", "DELETE");
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });
  });
});

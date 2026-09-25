/**
 * Regression test for a class of bug found in seller-locations.ts,
 * seller-metafields.ts, and seller-settings-route.ts: these routes read
 * `(req as any).userId` for the authenticated seller's id, but requireAuth
 * only ever sets `req.clerkUserId`. `req.userId` is always undefined, so
 * every raw-SQL query in these routes was scoped to `owner_id = NULL` —
 * silently returning nothing for reads and writing orphaned/NULL-owned rows
 * for creates, regardless of who was actually authenticated.
 *
 * This test mocks the DB layer to capture the bound SQL parameters and
 * asserts the owner scoping is actually driven by the authenticated caller's
 * clerkUserId, per route and per HTTP verb.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  clerkUserId: "seller-A",
}));

const captured = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; values: unknown[] }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.clerkUserId;
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: Array.from(strings).join("?"),
    values,
  }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: async (query: { text: string; values: unknown[] }) => {
      captured.calls.push({ text: query.text, values: query.values });
      // A generic row that satisfies whichever shape the caller reads
      // (rows[0].settings, rows[0].policies, rows[0].count, rows itself, …)
      // without needing per-route mocking.
      return {
        rows: [{
          id: "row-id",
          owner_id: query.values[0],
          settings: {},
          policies: [],
          count: "0",
          owner_resource: "products",
        }],
      };
    },
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const [
    { default: sellerLocationsRouter },
    { default: sellerMetafieldsRouter },
    { default: sellerSettingsRouter },
  ] = await Promise.all([
    import("../seller-locations"),
    import("../seller-metafields"),
    import("../seller-settings-route"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/seller/locations", sellerLocationsRouter);
  app.use("/api/seller/metafields", sellerMetafieldsRouter);
  app.use("/api/seller/settings", sellerSettingsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  captured.calls = [];
  state.clerkUserId = "seller-A";
});

function ownerIdParams(): unknown[] {
  // Every query in these routes binds owner_id as one of its interpolated
  // values. Collect every bound value across all calls made during the
  // request so the assertion doesn't depend on exact query shape.
  return captured.calls.flatMap((call) => call.values);
}

describe("seller-locations owner scoping uses the authenticated caller", () => {
  it("GET / binds the authenticated clerkUserId, never undefined", async () => {
    state.clerkUserId = "seller-A";
    const res = await fetch(`${base}/api/seller/locations`);
    expect(res.status).toBe(200);
    const params = ownerIdParams();
    expect(params.length).toBeGreaterThan(0);
    expect(params).toContain("seller-A");
    expect(params).not.toContain(undefined);
  });

  it("POST / inserts rows owned by the authenticated caller, not NULL", async () => {
    state.clerkUserId = "seller-B";
    const res = await fetch(`${base}/api/seller/locations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Warehouse" }),
    });
    expect(res.status).toBe(201);
    const params = ownerIdParams();
    expect(params).toContain("seller-B");
    expect(params).not.toContain(undefined);
  });

  it("PATCH /:id scopes the ownership check to the authenticated caller", async () => {
    state.clerkUserId = "seller-C";
    await fetch(`${base}/api/seller/locations/00000000-0000-4000-8000-000000000000`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New name" }),
    });
    const params = ownerIdParams();
    expect(params).toContain("seller-C");
    expect(params).not.toContain(undefined);
  });
});

describe("seller-metafields owner scoping uses the authenticated caller", () => {
  it("GET / binds the authenticated clerkUserId", async () => {
    state.clerkUserId = "seller-A";
    const res = await fetch(`${base}/api/seller/metafields`);
    expect(res.status).toBe(200);
    const params = ownerIdParams();
    expect(params).toContain("seller-A");
    expect(params).not.toContain(undefined);
  });

  it("POST / inserts a definition owned by the authenticated caller", async () => {
    state.clerkUserId = "seller-B";
    const res = await fetch(`${base}/api/seller/metafields`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerResource: "products", key: "material", name: "Material" }),
    });
    expect(res.status).toBe(201);
    const params = ownerIdParams();
    expect(params).toContain("seller-B");
    expect(params).not.toContain(undefined);
  });
});

describe("seller-settings-route owner scoping uses the authenticated caller", () => {
  it("GET / binds the authenticated clerkUserId", async () => {
    state.clerkUserId = "seller-A";
    const res = await fetch(`${base}/api/seller/settings`);
    expect(res.status).toBe(200);
    const params = ownerIdParams();
    expect(params).toContain("seller-A");
    expect(params).not.toContain(undefined);
  });

  it("PATCH / writes settings under the authenticated caller's owner id", async () => {
    state.clerkUserId = "seller-B";
    const res = await fetch(`${base}/api/seller/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "fr" }),
    });
    expect(res.status).toBe(200);
    const params = ownerIdParams();
    expect(params).toContain("seller-B");
    expect(params).not.toContain(undefined);
  });

  it("GET /integrations binds the authenticated clerkUserId", async () => {
    state.clerkUserId = "seller-C";
    const res = await fetch(`${base}/api/seller/settings/integrations`);
    expect(res.status).toBe(200);
    const params = ownerIdParams();
    expect(params).toContain("seller-C");
    expect(params).not.toContain(undefined);
  });
});

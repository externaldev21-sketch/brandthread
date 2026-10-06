/**
 * Share links with a non-uuid id (/c/demo, /drops/demo) used to reach
 * Postgres, which throws "invalid input syntax for type uuid" -> HTTP 500 and
 * the app showed "Something went wrong". They must be a plain 404 without
 * touching the database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { isUuid } from "../../lib/uuid";

const dbCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = "viewer"; next(); },
}));
vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_t, key) => String(key) });
  const fail = () => {
    dbCalls.count += 1;
    throw new Error('invalid input syntax for type uuid: "demo"');
  };
  const db = { select: fail, insert: fail, delete: fail, update: fail, execute: fail };
  return new Proxy({ db, readDb: db }, {
    get: (target, key) => (key in target ? (target as any)[key] : table),
  });
});

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: publicRouter } = await import("../public");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

describe("public share links with malformed ids", () => {
  it.each([
    ["GET", "/api/public/collections/demo"],
    ["GET", "/api/public/drops/demo"],
    ["GET", "/api/public/drops/demo/notify"],
    ["POST", "/api/public/drops/demo/notify"],
    ["DELETE", "/api/public/drops/demo/notify"],
  ])("%s %s is a 404 and never queries the database", async (method, path) => {
    dbCalls.count = 0;
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(404);
    expect(dbCalls.count).toBe(0);
  });
});

describe("isUuid", () => {
  it("accepts uuids and rejects everything else", () => {
    expect(isUuid("3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f")).toBe(true);
    expect(isUuid("demo")).toBe(false);
    expect(isUuid("ABC123")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f; drop")).toBe(false);
  });
});

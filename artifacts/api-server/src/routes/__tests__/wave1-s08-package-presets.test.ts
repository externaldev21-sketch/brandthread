/**
 * Wave 1 audit (slice s08): package presets must refuse values the
 * numeric(6,2) / integer columns can't hold correctly, and malformed ids,
 * with 4xx instead of a 500 or a silently stored zero.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, sellerPackagePresets } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `w1s08-preset-${suffix}`;
let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const { default: router } = await import("../package-presets");
  const app = express();
  app.use(express.json());
  app.use("/api/package-presets", router);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(sellerPackagePresets).where(eq(sellerPackagePresets.ownerId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const box = { name: "Box", weightOz: 12, lengthIn: 8, widthIn: 6, heightIn: 4 };

describe("package preset bounds", () => {
  it("rejects a dimension past numeric(6,2) with 400 (was a 500)", async () => {
    const res = await call("POST", "/api/package-presets", { ...box, lengthIn: 12_000 });
    expect(res.status).toBe(400);
    const created = await call("POST", "/api/package-presets", box);
    expect(created.status).toBe(201);
    const patched = await call("PATCH", `/api/package-presets/${created.body.preset.id}`, { heightIn: 10_000 });
    expect(patched.status).toBe(400);
  });

  it("rejects a dimension that rounds to 0.00", async () => {
    const res = await call("POST", "/api/package-presets", { ...box, widthIn: 0.001 });
    expect(res.status).toBe(400);
  });

  it("never stores a positive weight as 0 oz", async () => {
    const res = await call("POST", "/api/package-presets", { ...box, weightOz: 0.3 });
    expect(res.status).toBe(201);
    expect(res.body.preset.weightOz).toBe(1);
  });

  it("answers 404 for a malformed preset id (was a 500)", async () => {
    expect((await call("PATCH", "/api/package-presets/not-a-uuid", { name: "x" })).status).toBe(404);
    expect((await call("DELETE", "/api/package-presets/not-a-uuid")).status).toBe(404);
  });
});

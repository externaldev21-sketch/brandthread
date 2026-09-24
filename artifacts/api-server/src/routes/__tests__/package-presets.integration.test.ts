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
const sellerId = `preset-seller-${suffix}`;
const otherSellerId = `preset-other-${suffix}`;
let server: Server;
let base = "";

async function call(path: string, init: RequestInit = {}, userId = sellerId) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-test-user": userId, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
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
  await db.delete(sellerPackagePresets).where(eq(sellerPackagePresets.ownerId, sellerId));
  await db.delete(sellerPackagePresets).where(eq(sellerPackagePresets.ownerId, otherSellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("package presets CRUD", () => {
  it("creates, lists, updates, and deletes a preset scoped to the seller", async () => {
    const created = await call("/api/package-presets", {
      method: "POST",
      body: JSON.stringify({ name: "Small Box", weightOz: 12, lengthIn: 8, widthIn: 6, heightIn: 4 }),
    });
    expect(created.status).toBe(201);
    expect(created.body.preset).toMatchObject({ name: "Small Box", weightOz: 12, ownerId: sellerId });
    const presetId = created.body.preset.id;

    const listed = await call("/api/package-presets");
    expect(listed.status).toBe(200);
    expect(listed.body.presets.some((p: any) => p.id === presetId)).toBe(true);

    const updated = await call(`/api/package-presets/${presetId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Medium Box", weightOz: 20 }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.preset).toMatchObject({ name: "Medium Box", weightOz: 20 });

    const deleted = await call(`/api/package-presets/${presetId}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);

    const listedAfter = await call("/api/package-presets");
    expect(listedAfter.body.presets.some((p: any) => p.id === presetId)).toBe(false);
  });

  it("rejects invalid input", async () => {
    const missingName = await call("/api/package-presets", {
      method: "POST",
      body: JSON.stringify({ weightOz: 12, lengthIn: 8, widthIn: 6, heightIn: 4 }),
    });
    expect(missingName.status).toBe(400);

    const badWeight = await call("/api/package-presets", {
      method: "POST",
      body: JSON.stringify({ name: "Box", weightOz: -1, lengthIn: 8, widthIn: 6, heightIn: 4 }),
    });
    expect(badWeight.status).toBe(400);
  });

  it("scopes presets to the owning seller — another seller cannot see, update, or delete them", async () => {
    const created = await call("/api/package-presets", {
      method: "POST",
      body: JSON.stringify({ name: "Owner Only", weightOz: 16, lengthIn: 10, widthIn: 8, heightIn: 6 }),
    });
    const presetId = created.body.preset.id;

    const otherList = await call("/api/package-presets", {}, otherSellerId);
    expect(otherList.body.presets.some((p: any) => p.id === presetId)).toBe(false);

    const otherUpdate = await call(`/api/package-presets/${presetId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" }),
    }, otherSellerId);
    expect(otherUpdate.status).toBe(404);

    const otherDelete = await call(`/api/package-presets/${presetId}`, { method: "DELETE" }, otherSellerId);
    expect(otherDelete.status).toBe(404);
  });
});

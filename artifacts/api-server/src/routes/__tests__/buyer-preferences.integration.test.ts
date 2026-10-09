import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, buyerPreferences } from "@workspace/db";
import { eq } from "drizzle-orm";

const userId = `buyer-prefs-test-${crypto.randomBytes(6).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    if (!req.clerkUserId) return res.status(401).json({ error: "unauthorized" });
    next();
  },
}));

let server: Server;
let base = "";
const call = (method: string, body?: unknown, user: string | null = userId) =>
  fetch(`${base}/api/buyer/preferences`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const { default: router } = await import("../buyer-preferences");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/preferences", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(buyerPreferences).where(eq(buyerPreferences.userId, userId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("/api/buyer/preferences", () => {
  it("requires auth", async () => {
    expect((await call("GET", undefined, null)).status).toBe(401);
  });
  it("returns defaults when nothing is saved", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null });
  });
  it("merges partial updates across PUT and PATCH", async () => {
    await call("PUT", { sizes: { tops: "M", shoes: "10" } });
    const res = await call("PATCH", { sizes: { tops: "L", measurements: { heightCm: 180 } }, styleInterests: ["streetwear"] });
    const body = (await res.json()) as any;
    expect(body.sizes).toEqual({ tops: "L", shoes: "10", measurements: { heightCm: 180 } });
    expect(body.styleInterests).toEqual(["streetwear"]);
    const cleared = (await (await call("PATCH", { sizes: { shoes: null } })).json()) as any;
    expect(cleared.sizes).toEqual({ tops: "L", measurements: { heightCm: 180 } });
    expect(((await (await call("GET")).json()) as any).sizes.tops).toBe("L");
  });
  it("rejects invalid bodies", async () => {
    const res = await call("PATCH", { sizes: { measurements: { heightCm: 9999 } } });
    expect(res.status).toBe(400);
  });
});

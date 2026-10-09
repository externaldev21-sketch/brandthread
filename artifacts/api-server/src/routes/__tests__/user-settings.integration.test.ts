import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, userSettings } from "@workspace/db";
import { inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const userA = `user-settings-test-a-${suffix}`;
const userB = `user-settings-test-b-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    if (!req.clerkUserId) return res.status(401).json({ error: "unauthorized" });
    next();
  },
}));

let server: Server;
let base = "";
const call = (method: string, body?: unknown, user: string | null = userA) =>
  fetch(`${base}/api/me/settings`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const { default: router } = await import("../user-settings");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/me/settings", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(userSettings).where(inArray(userSettings.userId, [userA, userB]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("/api/me/settings", () => {
  it("requires auth for GET and PATCH", async () => {
    expect((await call("GET", undefined, null)).status).toBe(401);
    expect((await call("PATCH", { dataSaver: true }, null)).status).toBe(401);
  });

  it("returns empty settings when nothing is saved", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ settings: {}, updatedAt: null });
  });

  it("merges partial updates and removes keys set to null", async () => {
    const first = await call("PATCH", { dataSaver: true, theme: "dark", pronouns: "she/her" });
    expect(first.status).toBe(200);
    const second = (await (await call("PATCH", {
      theme: "light", pronouns: null, socialPrivacy: { whoCanSeePosts: "friends" },
    })).json()) as any;
    expect(second.settings).toEqual({ dataSaver: true, theme: "light", socialPrivacy: { whoCanSeePosts: "friends" } });
    expect(typeof second.updatedAt).toBe("string");
    const got = (await (await call("GET")).json()) as any;
    expect(got.settings).toEqual(second.settings);
  });

  it("rejects unknown keys, bad types and oversized payloads without writing", async () => {
    expect((await call("PATCH", { isAdmin: true })).status).toBe(400);
    expect((await call("PATCH", { dataSaver: "on" })).status).toBe(400);
    expect((await call("PATCH", { theme: "dark", junk: "x".repeat(20_000) })).status).toBe(413);
    const got = (await (await call("GET")).json()) as any;
    expect(got.settings.theme).toBe("light");
    expect(got.settings.isAdmin).toBeUndefined();
  });

  it("keeps each account's settings separate", async () => {
    await call("PATCH", { captions: false }, userB);
    const a = (await (await call("GET", undefined, userA)).json()) as any;
    const b = (await (await call("GET", undefined, userB)).json()) as any;
    expect(b.settings).toEqual({ captions: false });
    expect(a.settings.captions).toBeUndefined();
    expect(a.settings.dataSaver).toBe(true);
  });
});

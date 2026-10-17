import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("drizzle-orm", () => ({ eq: (...values: unknown[]) => values }));
vi.mock("@workspace/db", () => ({ users: {}, db: {} }));

import { requireAuth } from "../requireAuth";
import clerkStatusRouter from "../../routes/clerk-status";
import { isClerkKeyInvalid, resetClerkKeyStatus } from "../../lib/clerkKeyStatus";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  // Stand-in for clerkMiddleware: it reports why auth failed on these headers.
  app.use((req, res, next) => {
    const reason = req.header("x-test-clerk-reason");
    if (reason) res.setHeader("x-clerk-auth-reason", reason);
    next();
  });
  app.get("/me", requireAuth, (_req, res) => res.json({ ok: true }));
  app.use("/api/public", clerkStatusRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  resetClerkKeyStatus();
  vi.unstubAllEnvs();
});

describe("requireAuth + clerk_key_invalid", () => {
  it("keeps a plain 401 for a signed-out request", async () => {
    const res = await fetch(`${base}/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(isClerkKeyInvalid()).toBe(false);
  });

  it("names clerk_key_invalid when Clerk rejected the secret key, and remembers it", async () => {
    const res = await fetch(`${base}/me`, { headers: { "x-test-clerk-reason": "secret-key-invalid" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "clerk_key_invalid" });
    expect(isClerkKeyInvalid()).toBe(true);

    const status = await fetch(`${base}/api/public/clerk-status`);
    expect(await status.json()).toEqual({ clerkKeyInvalid: true });
  });

  it("reports nothing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await fetch(`${base}/api/public/clerk-status`);
    expect(res.status).toBe(404);
  });
});

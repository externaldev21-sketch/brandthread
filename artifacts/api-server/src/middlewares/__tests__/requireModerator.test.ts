import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({ role: "owner" }));

vi.mock("drizzle-orm", () => ({
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const users = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    users,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ role: state.role }],
          }),
        }),
      }),
    },
  };
});

import { requireModerator } from "../requireAuth";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.clerkUserId = "authenticated-user";
    next();
  });
  app.get("/reports", requireModerator, (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("requireModerator", () => {
  it("rejects authenticated marketplace users who are not platform admins", async () => {
    state.role = "owner";
    const response = await fetch(`${base}/reports`);
    expect(response.status).toBe(403);
  });

  it("allows an explicit platform admin", async () => {
    state.role = "admin";
    const response = await fetch(`${base}/reports`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
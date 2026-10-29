import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "w1s06-loyal"; next(); },
}));

let server: Server;
let base = "";
beforeAll(async () => {
  const { default: router } = await import("../loyalty");
  const app = express();
  app.use(express.json());
  app.use("/api/loyalty", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("POST /api/loyalty/redeem", () => {
  it("400s (not 500) when no body is sent", async () => {
    const res = await fetch(`${base}/api/loyalty/redeem`, { method: "POST" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toMatch(/Minimum redemption/);
  });
});

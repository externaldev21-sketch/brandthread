import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "w1s06-mfr-nobody" }) }));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => ({}) }));
vi.mock("../../lib/ageGate", () => ({ denyIfAgeRestricted: async () => false }));
vi.mock("../../lib/webOrigin", () => ({ getWebOrigin: () => "https://brandthread.app" }));
vi.mock("../../lib/brandthreadCallbackUrls", () => ({ isAllowedBrandthreadCallbackUrl: () => true }));

let server: Server;
let base = "";
beforeAll(async () => {
  const { default: router } = await import("../manufacturer-connect");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/manufacturers/connect", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("POST /api/manufacturers/connect/onboard without a body", () => {
  it("uses the default return URLs instead of failing with a 500", async () => {
    const res = await fetch(`${base}/api/manufacturers/connect/onboard`, { method: "POST" });
    // No manufacturer profile for this user: the handler reached the lookup.
    expect(res.status).toBe(404);
  });
});

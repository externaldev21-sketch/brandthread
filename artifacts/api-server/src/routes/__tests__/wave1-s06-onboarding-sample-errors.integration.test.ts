import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../lib/accountProfiles", () => ({
  personKeyFor: async () => { throw new Error("connection terminated: SECRET_DB_DETAIL"); },
}));
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: () => "p",
  generateImageBuffer: vi.fn(),
  generateWithVisualQa: vi.fn(),
  ImageQualityError: class extends Error {},
  ImageQualityUnavailableError: class extends Error {},
}));

const seller = `w1s06logo-${crypto.randomBytes(5).toString("hex")}`;
let server: Server;
let base = "";
beforeAll(async () => {
  await db.insert(users).values({ clerkId: seller, email: `${seller}@t.test`, name: "S", accountType: "seller", role: "owner", onboardingComplete: false });
  const { onboardingSampleRouter } = await import("../logo");
  const app = express();
  app.use(express.json());
  app.use("/api/onboarding-sample", onboardingSampleRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, seller));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/onboarding-sample/logo reservation failure", () => {
  it("answers a retryable 503 (not 429 'used') without the internal error text", async () => {
    const res = await fetch(`${base}/api/onboarding-sample/logo`, {
      method: "POST", headers: { "content-type": "application/json", "x-test-user": seller }, body: JSON.stringify({ brandName: "Acme" }),
    });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toContain("SECRET_DB_DETAIL");
  });
});

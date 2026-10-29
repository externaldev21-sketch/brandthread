import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id");
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: () => "p",
  editImages: vi.fn(),
  generateWithVisualQa: vi.fn(),
  ImageQualityError: class extends Error {},
  ImageQualityUnavailableError: class extends Error {},
}));

let server: Server;
let base = "";
beforeAll(async () => {
  const { default: router } = await import("../lifestyle");
  const app = express();
  app.use(express.json());
  app.use("/api/lifestyle", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const generate = (user: string) => fetch(`${base}/api/lifestyle/generate`, {
  method: "POST", headers: { "content-type": "application/json", "x-test-user-id": user }, body: "{}",
}).then((r) => r.status);

describe("POST /api/lifestyle/generate rate limit", () => {
  it("is per user, not one bucket shared by everyone", async () => {
    for (let i = 0; i < 5; i++) expect(await generate("w1s06-life-a")).toBe(400);
    expect(await generate("w1s06-life-a")).toBe(429);
    // A different user is unaffected by user A's usage.
    expect(await generate("w1s06-life-b")).toBe(400);
  });
});

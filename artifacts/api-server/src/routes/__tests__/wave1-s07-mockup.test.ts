/**
 * Wave 1 / s07: POST /api/mockup/generate rate-limits per signed-in user.
 * Clerk installs `req.auth` as a function, so the old `req.auth?.userId`
 * lookup was always undefined and every user shared one "anon" bucket —
 * five generations anywhere locked everyone out for a minute.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const userId = req.headers["x-test-user"];
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    // What @clerk/express actually installs: a function, not an object.
    req.auth = () => ({ userId });
    req.clerkUserId = userId;
    next();
  },
}));

vi.mock("@workspace/integrations-openai-ai-server/image", () => ({
  buildFashionPrompt: (_op: string, brief: string) => brief,
  generateWithVisualQa: async () => Buffer.from("png"),
  editImages: async () => Buffer.from("png"),
  generateImageBuffer: async () => Buffer.from("png"),
  ImageQualityError: class extends Error {},
  ImageQualityUnavailableError: class extends Error {},
}));

let server: Server;
let base = "";

const generate = (user: string) => fetch(`${base}/api/mockup/generate`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-test-user": user },
  body: JSON.stringify({ prompt: "a boxy tee" }),
});

beforeAll(async () => {
  const { default: router } = await import("../mockup");
  const app = express();
  app.use(express.json());
  app.use("/api/mockup", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("mockup generation rate limit", () => {
  it("limits each user separately", async () => {
    for (let i = 0; i < 5; i += 1) expect((await generate("user-a")).status).toBe(200);
    expect((await generate("user-a")).status).toBe(429);
    expect((await generate("user-b")).status).toBe(200);
  });
});

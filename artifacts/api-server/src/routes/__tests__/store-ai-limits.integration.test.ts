/**
 * /store/ai is a seller tool with bounded input: buyers are refused, `answers`
 * keeps only whitelisted keys with strings of at most 500 characters and 4 KB
 * in total, and nothing unbounded reaches the model prompt.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";

const ai = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock("@clerk/express", () => ({ getAuth: (req: any) => ({ userId: req.headers["x-test-user"] ?? null }) }));
vi.mock("@workspace/integrations-openai-ai-server/text", () => ({
  generateText: vi.fn(async (_system: string, prompt: string) => { ai.prompts.push(prompt); return "{}"; }),
}));

import storeAiRouter, { STORE_AI_MAX_STRING, storeAnswersSchema } from "../store-ai";

const SELLER = `store-ai-test-seller-${crypto.randomUUID()}`;
const BUYER = `store-ai-test-buyer-${crypto.randomUUID()}`;
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([SELLER, BUYER].map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: "Test Person", displayName: "Test Person",
    username: clerkId.replace(/-/g, "_").slice(0, 28), accountType: clerkId === SELLER ? "seller" : "buyer",
  }))).onConflictDoNothing();
  const app = express();
  app.use(express.json());
  app.use("/store/ai", storeAiRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER]));
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

beforeEach(() => { ai.prompts.length = 0; });

const post = (path: string, user: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body) });

describe("store AI access", () => {
  it("refuses buyer accounts before any model call", async () => {
    const r = await post("/store/ai/generate", BUYER, { answers: { primaryStyle: "minimal" } });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "seller_only" });
    expect(ai.prompts).toHaveLength(0);
  });

  it("requires sign-in", async () => {
    const r = await fetch(`${base}/store/ai/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });
});

describe("answers validation", () => {
  it("drops unknown keys and keeps whitelisted ones", async () => {
    const r = await post("/store/ai/generate", SELLER, {
      answers: { primaryStyle: "minimal", moods: ["clean"], logoUri: "file:///x.png", injected: "x".repeat(400) },
    });
    expect(r.status).toBe(200);
    expect(ai.prompts[0]).toContain("minimal");
    expect(ai.prompts[0]).not.toContain("logoUri");
    expect(ai.prompts[0]).not.toContain("injected");
  });

  it("refuses short fields over 500 characters", async () => {
    const r = await post("/store/ai/generate", SELLER, { answers: { primaryStyle: "x".repeat(STORE_AI_MAX_STRING + 1) } });
    expect(r.status).toBe(400);
    expect(ai.prompts).toHaveLength(0);
  });

  it("clamps free-text fields to 500 characters", async () => {
    const r = await post("/store/ai/generate", SELLER, { answers: { brandStory: "s".repeat(3000) } });
    expect(r.status).toBe(200);
    expect(ai.prompts[0]).toContain("s".repeat(STORE_AI_MAX_STRING));
    expect(ai.prompts[0]).not.toContain("s".repeat(STORE_AI_MAX_STRING + 1));
  });

  it("refuses answers over 4 KB in total", async () => {
    const long = (n: number) => Array.from({ length: 20 }, (_, i) => `${i}-${"y".repeat(n)}`);
    const r = await post("/store/ai/generate", SELLER, { answers: { moods: long(100), features: long(100), targetCustomers: long(100) } });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: "answers_too_large" });
    expect(ai.prompts).toHaveLength(0);
  });

  it("refuses answers that are not an object", async () => {
    expect((await post("/store/ai/generate", SELLER, { answers: "x".repeat(10_000) })).status).toBe(400);
    expect((await post("/store/ai/generate", SELLER, { answers: { moods: "clean" } })).status).toBe(400);
  });

  it("bounds the social import context and URL", async () => {
    const r = await post("/store/ai/from-social", SELLER, {
      socialUrl: `brand whose posts include: ${"t".repeat(5000)}`, postCount: 3, postTitles: "p".repeat(5000), extra: "z".repeat(9000),
    });
    expect(r.status).toBe(200);
    expect(ai.prompts[0]!.length).toBeLessThan(2 * STORE_AI_MAX_STRING + 400);
    expect(ai.prompts[0]).not.toContain("zzz");
  });

  it("accepts the questionnaire the app sends", () => {
    const parsed = storeAnswersSchema.parse({
      primaryStyle: "streetwear", secondaryStyles: ["y2k"], moods: ["bold"],
      colors: { primary: "#000", secondary: "#fff", accent: "#f00", background: "#fff", text: "#000", buttonText: "#fff" },
      typography: "modern", homepagePriority: "hero_image", additionalSections: [], brandStory: "story",
      targetCustomers: ["women"], ageRange: { min: 18, max: 35 }, audienceDescription: "", existingContent: ["logo"],
      features: ["wishlist"], logoUri: "file:///logo.png", moodBoardUris: ["file:///a.png"], contentUploads: { product_photos: ["file:///b.png"] },
    });
    expect(parsed).not.toHaveProperty("logoUri");
    expect(parsed).not.toHaveProperty("contentUploads");
    expect(parsed.primaryStyle).toBe("streetwear");
  });
});

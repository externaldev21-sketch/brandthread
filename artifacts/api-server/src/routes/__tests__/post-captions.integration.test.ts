import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, pool, posts, postCaptions, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const ownerId = `captions-owner-${suffix}`;
const otherId = `captions-other-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" as string }));
const openaiCreate = vi.hoisted(() => vi.fn());

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/safety")>();
  return { ...actual, optionalViewerId: () => authState.clerkUserId || null };
});
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { audio: { transcriptions: { create: openaiCreate } } },
}));

let server: Server;
let base = "";
let videoId = "";
let photoId = "";
let heldId = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* vtt */ }
  return { status: response.status, body, headers: response.headers };
}

async function setFlag(enabled: boolean) {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ('autoCaptions', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`, [enabled]);
  const { resetCaptionsFlagCache } = await import("../../lib/captions");
  resetCaptionsFlagCache();
}

beforeAll(async () => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://ai.test";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  await db.insert(users).values([
    { clerkId: ownerId, email: `${ownerId}@test.local`, name: "Cap Owner", displayName: "Cap Owner", role: "seller", accountType: "seller" },
    { clerkId: otherId, email: `${otherId}@test.local`, name: "Cap Other", displayName: "Cap Other", role: "buyer", accountType: "buyer" },
  ]);
  const base_ = { userId: ownerId, mediaUrl: "https://cdn.test/v.mp4", mediaUrls: ["https://cdn.test/v.mp4"], postStatus: "published" };
  const [video] = await db.insert(posts).values({ ...base_, mediaType: "video" }).returning();
  const [photo] = await db.insert(posts).values({ ...base_, mediaType: "photo" }).returning();
  const [held] = await db.insert(posts).values({ ...base_, mediaType: "video", moderationStatus: "held" }).returning();
  videoId = video.id; photoId = photo.id; heldId = held.id;
  await db.insert(postCaptions).values([
    { postId: videoId, language: "en", status: "ready", source: "whisper",
      segments: [{ start: 0, end: 2, text: "Hello" }, { start: 2, end: 4, text: "World" }],
      vtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello\n\n2\n00:00:02.000 --> 00:00:04.000\nWorld\n" },
    { postId: heldId, language: "en", status: "ready", segments: [{ start: 0, end: 1, text: "x" }], vtt: "WEBVTT\n\n" },
  ]);
  const { default: captionsRouter } = await import("../post-captions");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", captionsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(postCaptions).where(inArray(postCaptions.postId, [videoId, photoId, heldId]));
  await db.delete(posts).where(inArray(posts.id, [videoId, photoId, heldId]));
  await db.delete(users).where(inArray(users.clerkId, [ownerId, otherId]));
  await pool.query("DELETE FROM feature_flags WHERE key = 'autoCaptions' AND description = 'test'");
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("flag and env gating", () => {
  it("ships off: migration row has enabled=false and every endpoint answers 503", async () => {
    await pool.query("DELETE FROM feature_flags WHERE key = 'autoCaptions'");
    await pool.query(`INSERT INTO feature_flags (key, enabled, description)
      VALUES ('autoCaptions', false, 'Auto-generated captions (subtitles) on video posts')
      ON CONFLICT (key) DO NOTHING`);
    const { resetCaptionsFlagCache } = await import("../../lib/captions");
    resetCaptionsFlagCache();
    authState.clerkUserId = ownerId;
    for (const [method, path] of [
      ["GET", `/api/posts/${videoId}/captions`],
      ["GET", `/api/posts/${videoId}/captions/en.vtt`],
      ["POST", `/api/posts/${videoId}/captions/generate`],
      ["PATCH", `/api/posts/${videoId}/captions/en`],
      ["DELETE", `/api/posts/${videoId}/captions/en`],
    ] as const) {
      const res = await request(path, { method, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.body.code).toBe("CAPTIONS_UNAVAILABLE");
    }
  });

  it("answers 503 when the flag is on but the AI keys are missing", async () => {
    await setFlag(true);
    const keep = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    try {
      const res = await request(`/api/posts/${videoId}/captions`);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("CAPTIONS_UNAVAILABLE");
    } finally {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = keep;
    }
  });
});

describe("with the flag on", () => {
  beforeAll(async () => { await setFlag(true); });

  it("lists ready tracks publicly and serves WebVTT with caching", async () => {
    authState.clerkUserId = "";
    const list = await request(`/api/posts/${videoId}/captions`);
    expect(list.status).toBe(200);
    expect(list.body.tracks).toHaveLength(1);
    expect(list.body.tracks[0]).toMatchObject({ language: "en", status: "ready" });
    expect(list.body.tracks[0].vttUrl).toBe(`/api/posts/${videoId}/captions/en.vtt`);
    const vtt = await request(`/api/posts/${videoId}/captions/en.vtt`);
    expect(vtt.status).toBe(200);
    expect(vtt.headers.get("content-type")).toContain("text/vtt");
    expect(vtt.headers.get("cache-control")).toContain("max-age");
    expect(String(vtt.body)).toMatch(/^WEBVTT/);
    const json = await request(`/api/posts/${videoId}/captions/en`);
    expect(json.body.segments).toHaveLength(2);
  });

  it("hides captions of posts held by moderation from non-owners", async () => {
    authState.clerkUserId = otherId;
    expect((await request(`/api/posts/${heldId}/captions`)).status).toBe(404);
    authState.clerkUserId = ownerId;
    expect((await request(`/api/posts/${heldId}/captions`)).status).toBe(200);
  });

  it("only lets the owner generate, edit and delete", async () => {
    authState.clerkUserId = otherId;
    expect((await request(`/api/posts/${videoId}/captions/generate`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await request(`/api/posts/${videoId}/captions/en`, {
      method: "PATCH", body: JSON.stringify({ segments: [{ text: "a" }, { text: "b" }] }),
    })).status).toBe(403);
    expect((await request(`/api/posts/${videoId}/captions/en`, { method: "DELETE" })).status).toBe(403);
  });

  it("rejects generating captions for a photo", async () => {
    authState.clerkUserId = ownerId;
    const res = await request(`/api/posts/${photoId}/captions/generate`, { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NOT_A_VIDEO");
  });

  it("is idempotent: generate on a post with ready captions starts nothing", async () => {
    authState.clerkUserId = ownerId;
    const res = await request(`/api/posts/${videoId}/captions/generate`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("stores a failed track (never throws, never calls Whisper) when the video cannot be read", async () => {
    const [fresh] = await db.insert(posts).values({
      userId: ownerId, mediaUrl: "https://cdn.test/external.mp4", mediaUrls: [], mediaType: "video", postStatus: "published",
    }).returning();
    try {
      authState.clerkUserId = ownerId;
      const res = await request(`/api/posts/${fresh.id}/captions/generate`, { method: "POST", body: "{}" });
      expect(res.status).toBe(202);
      let row: typeof postCaptions.$inferSelect | undefined;
      for (let i = 0; i < 50 && row?.status !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 50));
        [row] = await db.select().from(postCaptions).where(eq(postCaptions.postId, fresh.id));
      }
      expect(row?.status).toBe("failed");
      expect(openaiCreate).not.toHaveBeenCalled();
      const owner = await request(`/api/posts/${fresh.id}/captions`);
      expect(owner.body.tracks[0].status).toBe("failed");
      authState.clerkUserId = otherId;
      expect((await request(`/api/posts/${fresh.id}/captions`)).body.tracks).toHaveLength(0);
    } finally {
      await db.delete(postCaptions).where(eq(postCaptions.postId, fresh.id));
      await db.delete(posts).where(eq(posts.id, fresh.id));
    }
  });

  it("lets the owner edit text (timing is kept) and rebuilds the VTT", async () => {
    authState.clerkUserId = ownerId;
    const bad = await request(`/api/posts/${videoId}/captions/en`, {
      method: "PATCH", body: JSON.stringify({ segments: [{ text: "only one" }] }),
    });
    expect(bad.status).toBe(400);
    const res = await request(`/api/posts/${videoId}/captions/en`, {
      method: "PATCH", body: JSON.stringify({ segments: [{ text: "Hi friends", start: 99 }, { text: "World" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("manual");
    expect(res.body.segments[0]).toEqual({ start: 0, end: 2, text: "Hi friends" });
    const vtt = await request(`/api/posts/${videoId}/captions/en.vtt`);
    expect(String(vtt.body)).toContain("Hi friends");
    const rejected = await request(`/api/posts/${videoId}/captions/en`, {
      method: "PATCH", body: JSON.stringify({ segments: [{ text: "kill yourself" }, { text: "World" }] }),
    });
    expect(rejected.status).toBe(422);
  });

  it("lets the owner delete a track", async () => {
    authState.clerkUserId = ownerId;
    const res = await request(`/api/posts/${videoId}/captions/en`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await request(`/api/posts/${videoId}/captions/en`)).status).toBe(404);
  });
});

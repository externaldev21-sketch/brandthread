/**
 * Hidden Words (feature 71): the post owner's custom words hide matching
 * comments from everyone but the commenter; GET/PUT /api/safety/hidden-words.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { commentFilters, db, notificationsFeed, posts, users } from "@workspace/db";

const published = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.header("x-test-user-id");
    if (!who) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: () => void) => next() }));
vi.mock("../../lib/safety", async (orig) => {
  const actual: any = await orig();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});
vi.mock("../notifications-feed", () => ({ publishNotification: async (n: any) => { published.calls.push(n); } }));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `hw-${n}-${suffix}`;
const owner = id("owner");
const alice = id("alice");
const bob = id("bob");
const userIds = [owner, alice, bob];
let server: Server;
let base = "";
let postId = "";

async function call(path: string, userId: string | null, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const comment = (who: string, text: string) => call(`/api/posts/${postId}/comments`, who, "POST", { body: text });
const visibleTo = async (who: string | null) => (await call(`/api/posts/${postId}/comments`, who)).body.comments.map((c: any) => c.body);

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: u, username: u.replace(/-/g, "_"), role: "buyer", accountType: "buyer",
  })) as any);
  const [p] = await db.insert(posts).values({
    userId: owner, mediaUrl: `https://cdn.test/${suffix}.jpg`, mediaType: "image", postStatus: "published",
  }).returning({ id: posts.id });
  postId = p.id;
  const { default: commentsRouter } = await import("../post-comments");
  const { default: hiddenWordsRouter } = await import("../hidden-words");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", commentsRouter);
  app.use("/api/safety/hidden-words", hiddenWordsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(commentFilters).where(inArray(commentFilters.userId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { published.calls.length = 0; });

describe("/api/safety/hidden-words", () => {
  it("starts empty with hiding on", async () => {
    expect((await call("/api/safety/hidden-words", owner)).body).toEqual({ hideCustom: true, words: [] });
  });

  it("saves a normalised, de-duplicated list", async () => {
    const r = await call("/api/safety/hidden-words", owner, "PUT", { words: ["Fake", "fake", "  ugly  "] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ hideCustom: true, words: ["fake", "ugly"] });
  });

  it("rejects bad input", async () => {
    expect((await call("/api/safety/hidden-words", owner, "PUT", { words: ["!!!"] })).status).toBe(400);
    expect((await call("/api/safety/hidden-words", owner, "PUT", { hideCustom: "yes" })).status).toBe(400);
    expect((await call("/api/safety/hidden-words", null)).status).toBe(401);
  });
});

describe("comments on the owner's posts", () => {
  it("hides a matching comment from everyone but its author, and doesn't notify", async () => {
    expect((await comment(alice, "this looks fake")).status).toBe(201);
    expect((await comment(bob, "love the fit")).status).toBe(201);
    expect(await visibleTo(owner)).toEqual(["love the fit"]);
    expect(await visibleTo(null)).toEqual(["love the fit"]);
    expect(await visibleTo(alice)).toEqual(expect.arrayContaining(["this looks fake", "love the fit"]));
    expect(published.calls.filter((c) => c.userId === owner).map((c) => c.body ?? c.title).join(" ")).not.toContain("fake");
  });

  it("matches whole words only", async () => {
    await comment(bob, "fakeout drop when");
    expect(await visibleTo(owner)).toContain("fakeout drop when");
  });

  it("stops hiding new comments when turned off", async () => {
    await call("/api/safety/hidden-words", owner, "PUT", { hideCustom: false });
    await comment(bob, "fake but cute");
    expect(await visibleTo(owner)).toContain("fake but cute");
  });

  it("never hides the owner's own comments", async () => {
    await call("/api/safety/hidden-words", owner, "PUT", { hideCustom: true });
    await comment(owner, "not fake, made in LA");
    expect(await visibleTo(bob)).toContain("not fake, made in LA");
  });
});

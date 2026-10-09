import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, notificationsFeed, posts, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `post-sched-seller-${suffix}`;
const buyerId = `post-sched-buyer-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));
const aclCalls = vi.hoisted(() => ({ calls: [] as Array<{ paths: string[]; visibility: string }> }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
}));

vi.mock("../post-video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../post-video")>();
  return {
    ...actual,
    setComposedMediaVisibility: vi.fn(async (_id: string, paths: string[], visibility: string) => {
      aclCalls.calls.push({ paths, visibility });
    }),
  };
});

let server: Server;
let base = "";

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json()) as any };
}
const post = (path: string, body?: unknown) =>
  request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Sched Seller", displayName: "Sched Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Sched Buyer", displayName: "Sched Buyer", role: "buyer", accountType: "buyer" },
  ]);
  const { default: postsRouter } = await import("../posts");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  await db.delete(posts).where(inArray(posts.userId, [sellerId, buyerId]));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, buyerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function insertScheduled(overrides: Partial<typeof posts.$inferInsert> = {}) {
  const [row] = await db.insert(posts).values({
    userId: sellerId,
    mediaUrl: "",
    mediaUrls: ["https://cdn.test/a.jpg"],
    mediaType: "photo",
    caption: "due post",
    postStatus: "scheduled",
    scheduledAt: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - 3_600_000),
    ...overrides,
  }).returning();
  return row;
}

describe("scheduled post publisher", () => {
  it("flips due posts once, sets publishedAt, promotes media and notifies the author once", async () => {
    const { publishDuePosts } = await import("../../lib/postPublish");
    const scheduledAt = new Date(Date.now() - 120_000);
    const due = await insertScheduled({
      scheduledAt,
      mediaUrl: "https://api.test/api/posts/media/uploads/abc-video",
      mediaPaths: ["/objects/uploads/slide-1"],
    });
    const future = await insertScheduled({ scheduledAt: new Date(Date.now() + 3_600_000), caption: "future" });
    aclCalls.calls.length = 0;

    const first = await publishDuePosts();
    expect(first.map((p) => p.id)).toContain(due.id);
    expect(first.map((p) => p.id)).not.toContain(future.id);

    const [row] = await db.select().from(posts).where(eq(posts.id, due.id));
    expect(row.postStatus).toBe("published");
    expect(row.publishedAt?.getTime()).toBe(scheduledAt.getTime());
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(aclCalls.calls.some((c) => c.visibility === "public" && c.paths.includes("/objects/uploads/slide-1"))).toBe(true);

    const second = await publishDuePosts();
    expect(second.map((p) => p.id)).not.toContain(due.id);

    const notes = await db.select().from(notificationsFeed).where(and(
      eq(notificationsFeed.userId, sellerId), eq(notificationsFeed.targetId, due.id),
    ));
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Your scheduled post is live");

    const [stillFuture] = await db.select().from(posts).where(eq(posts.id, future.id));
    expect(stillFuture.postStatus).toBe("scheduled");
  });

  it("is safe under concurrent runs: each post is claimed by exactly one runner", async () => {
    const { publishDuePosts } = await import("../../lib/postPublish");
    const rows = await Promise.all(Array.from({ length: 6 }, (_, i) => insertScheduled({ caption: `race ${i}` })));
    const ids = new Set(rows.map((r) => r.id));
    const runs = await Promise.all([publishDuePosts(), publishDuePosts(), publishDuePosts()]);
    const claimed = runs.flat().map((p) => p.id).filter((id) => ids.has(id));
    expect(claimed).toHaveLength(ids.size);
    expect(new Set(claimed).size).toBe(ids.size);
    const notes = await db.select().from(notificationsFeed).where(and(
      eq(notificationsFeed.userId, sellerId), eq(notificationsFeed.type, "scheduled_post_live"),
      inArray(notificationsFeed.targetId, [...ids]),
    ));
    expect(notes).toHaveLength(ids.size);
  });

  it("does not announce a post that moderation is holding", async () => {
    const { publishDuePosts } = await import("../../lib/postPublish");
    const held = await insertScheduled({ moderationStatus: "held", moderationReason: "test" });
    await publishDuePosts();
    const [row] = await db.select().from(posts).where(eq(posts.id, held.id));
    expect(row.postStatus).toBe("published");
    const notes = await db.select().from(notificationsFeed).where(eq(notificationsFeed.targetId, held.id));
    expect(notes).toHaveLength(0);
  });
});

describe("drafts and scheduling API", () => {
  it("validates the scheduling window on create", async () => {
    authState.clerkUserId = sellerId;
    const base = { mediaType: "photo", mediaUrls: ["https://cdn.test/x.jpg"], caption: "w" };
    const tooSoon = await post("/api/posts", { ...base, scheduledAt: inMinutes(2) });
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.code).toBe("INVALID_SCHEDULE_TIME");
    const tooFar = await post("/api/posts", { ...base, scheduledAt: inMinutes(76 * 24 * 60) });
    expect(tooFar.status).toBe(400);
    const ok = await post("/api/posts", { ...base, scheduledAt: inMinutes(10) });
    expect(ok.status).toBe(201);
    expect(ok.body.postStatus).toBe("scheduled");
  });

  it("schedule -> reschedule -> unschedule -> publish-now lifecycle", async () => {
    authState.clerkUserId = sellerId;
    const draft = await post("/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/d.jpg"], caption: "life", isDraft: true });
    expect(draft.status).toBe(201);
    const id = draft.body.id as string;

    expect((await post(`/api/posts/${id}/schedule`, { scheduledAt: inMinutes(1) })).status).toBe(400);
    const sched = await post(`/api/posts/${id}/schedule`, { scheduledAt: inMinutes(30) });
    expect(sched.status).toBe(200);
    expect(sched.body.postStatus).toBe("scheduled");
    const resched = await post(`/api/posts/${id}/schedule`, { scheduledAt: inMinutes(60) });
    expect(resched.status).toBe(200);

    const un = await post(`/api/posts/${id}/unschedule`);
    expect(un.status).toBe(200);
    expect(un.body.postStatus).toBe("draft");
    expect(un.body.scheduledAt).toBeNull();
    expect((await post(`/api/posts/${id}/unschedule`)).status).toBe(200);

    const live = await post(`/api/posts/${id}/publish-now`);
    expect(live.status).toBe(200);
    expect(live.body.postStatus).toBe("published");
    expect(live.body.publishedAt).toBeTruthy();
    expect((await post(`/api/posts/${id}/publish-now`)).status).toBe(200);
    expect((await post(`/api/posts/${id}/unschedule`)).status).toBe(409);
    expect((await post(`/api/posts/${id}/schedule`, { scheduledAt: inMinutes(30) })).status).toBe(409);
  });

  it("lists by status and rejects unknown filters", async () => {
    authState.clerkUserId = sellerId;
    const drafts = await request("/api/posts/mine?status=draft");
    expect(drafts.status).toBe(200);
    expect(drafts.body.every((p: any) => p.postStatus === "draft")).toBe(true);
    const scheduled = await request("/api/posts/mine?status=scheduled");
    expect(scheduled.body.length).toBeGreaterThan(0);
    expect(scheduled.body.every((p: any) => p.postStatus === "scheduled")).toBe(true);
    expect((await request("/api/posts/mine?status=bogus")).status).toBe(400);
  });

  it("keeps buyers unable to schedule but lets them publish their own drafts now", async () => {
    authState.clerkUserId = buyerId;
    const draft = await post("/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/b.jpg"], isDraft: true });
    expect(draft.status).toBe(201);
    const sched = await post(`/api/posts/${draft.body.id}/schedule`, { scheduledAt: inMinutes(30) });
    expect(sched.status).toBe(403);
    expect(sched.body.code).toBe("BUYER_NO_SCHEDULING");
    const live = await post(`/api/posts/${draft.body.id}/publish-now`);
    expect(live.body.postStatus).toBe("published");
  });

  it("does not let another user touch a post", async () => {
    authState.clerkUserId = sellerId;
    const draft = await post("/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/o.jpg"], isDraft: true });
    authState.clerkUserId = buyerId;
    expect((await post(`/api/posts/${draft.body.id}/publish-now`)).status).toBe(404);
  });

  it("caps drafts per user", async () => {
    authState.clerkUserId = buyerId;
    const { MAX_DRAFTS_PER_USER } = await import("../../lib/postPublish");
    const existing = await db.select({ id: posts.id }).from(posts)
      .where(and(eq(posts.userId, buyerId), eq(posts.postStatus, "draft")));
    const need = MAX_DRAFTS_PER_USER - existing.length;
    await db.insert(posts).values(Array.from({ length: need }, (_, i) => ({
      userId: buyerId, mediaUrl: "", mediaUrls: ["https://cdn.test/c.jpg"], caption: `bulk ${i}`, postStatus: "draft",
    })));
    const over = await post("/api/posts", { mediaType: "photo", mediaUrls: ["https://cdn.test/c.jpg"], isDraft: true });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("DRAFT_LIMIT_REACHED");
  });
});

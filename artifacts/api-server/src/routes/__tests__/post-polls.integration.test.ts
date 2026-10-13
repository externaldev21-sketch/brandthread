import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { blocks, db, posts, postPolls, postPollVotes, users } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const author = `poll-author-${suffix}`;
const voter = `poll-voter-${suffix}`;
const voter2 = `poll-voter2-${suffix}`;
const blockedUser = `poll-blocked-${suffix}`;
const userIds = [author, voter, voter2, blockedUser];
const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id") || auth.userId;
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/safety")>();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});

let server: Server;
let base = "";
const ids: Record<string, string> = {};

async function call(method: string, path: string, userId: string | null, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const put = (postId: string, userId: string | null, body: unknown) => call("PUT", `/api/posts/${postId}/poll`, userId, body);
const vote = (postId: string, userId: string | null, optionIndex: unknown) => call("POST", `/api/posts/${postId}/poll/vote`, userId, { optionIndex });
const get = (postId: string, userId: string | null) => call("GET", `/api/posts/${postId}/poll`, userId);

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@test.local`, name: u, displayName: u,
    role: u === author ? "seller" : "buyer", accountType: u === author ? "seller" : "buyer",
  })));
  await db.insert(blocks).values({ blockerId: author, blockedId: blockedUser });
  const common = { userId: author, mediaUrl: "https://cdn.test/a.jpg", mediaUrls: ["https://cdn.test/a.jpg"], mediaType: "photo" };
  const now = Date.now();
  const make = async (key: string, values: Record<string, unknown>) => {
    const [row] = await db.insert(posts).values({ ...common, ...values } as any).returning();
    ids[key] = row.id;
  };
  await make("thread", { surface: "thread", postStatus: "published", publishedAt: new Date(now - 60_000) });
  await make("ended", { surface: "thread", postStatus: "published", publishedAt: new Date(now - 2 * 3_600_000) });
  await make("draft", { surface: "thread", postStatus: "draft" });
  await make("profile", { surface: "profile", postStatus: "published", publishedAt: new Date(now) });
  await make("held", { surface: "thread", postStatus: "published", publishedAt: new Date(now), moderationStatus: "held" });
  await make("plain", { surface: "thread", postStatus: "published", publishedAt: new Date(now) });
  await make("cascade", { surface: "thread", postStatus: "published", publishedAt: new Date(now) });
  const { default: pollsRouter } = await import("../post-polls");
  const app = express();
  app.use(express.json());
  app.use("/api/posts", pollsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(posts).where(inArray(posts.id, Object.values(ids)));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, userIds), inArray(blocks.blockedId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("creating a poll", () => {
  it("lets the author attach a poll to their Thread (default 1 day)", async () => {
    const res = await put(ids.thread, author, { options: [" Linen ", "Denim", "Silk"] });
    expect(res.status).toBe(200);
    expect(res.body.poll).toMatchObject({
      postId: ids.thread, durationMinutes: 1440, totalVotes: 0, isAuthor: true, canVote: false, showResults: true, myVote: null,
    });
    expect(res.body.poll.options.map((o: any) => o.text)).toEqual(["Linen", "Denim", "Silk"]);
    const ends = new Date(res.body.poll.endsAt).getTime();
    expect(Math.abs(ends - (Date.now() - 60_000 + 1440 * 60_000))).toBeLessThan(5_000);
  });

  it("only the author, only on Threads, only with valid input, and never signed out", async () => {
    expect((await put(ids.plain, voter, { options: ["a", "b"] })).body.code).toBe("NOT_POST_OWNER");
    const profile = await put(ids.profile, author, { options: ["a", "b"] });
    expect(profile.status).toBe(400);
    expect(profile.body.code).toBe("POLL_THREADS_ONLY");
    expect((await put(ids.plain, author, { options: ["only one"] })).status).toBe(400);
    expect((await put(ids.plain, author, { options: ["a", "b"], durationMinutes: 99999 })).status).toBe(400);
    expect((await put(ids.plain, null, { options: ["a", "b"] })).status).toBe(401);
    expect((await put("not-a-uuid", author, { options: ["a", "b"] })).status).toBe(404);
    expect((await put(crypto.randomUUID(), author, { options: ["a", "b"] })).status).toBe(404);
  });

  it("can attach to a draft; nobody else can see or vote on it", async () => {
    expect((await put(ids.draft, author, { options: ["a", "b"], durationMinutes: 60 })).status).toBe(200);
    const mine = await get(ids.draft, author);
    expect(mine.status).toBe(200);
    expect(mine.body.poll.endsAt).toBeNull();
    expect((await get(ids.draft, voter)).status).toBe(404);
    expect((await vote(ids.draft, voter, 0)).status).toBe(404);
  });
});

describe("voting", () => {
  it("hides results until you vote, but shows the total", async () => {
    const before = await get(ids.thread, voter);
    expect(before.status).toBe(200);
    expect(before.body.poll).toMatchObject({ showResults: false, canVote: true, myVote: null, totalVotes: 0 });
    expect(before.body.poll.options.every((o: any) => o.percent === null && o.votes === null)).toBe(true);
    const guest = await get(ids.thread, null);
    expect(guest.body.poll.showResults).toBe(false);
  });

  it("records one vote, shows results, and refuses a second or changed vote", async () => {
    const first = await vote(ids.thread, voter, 1);
    expect(first.status).toBe(201);
    expect(first.body.poll).toMatchObject({ myVote: 1, showResults: true, canVote: false, totalVotes: 1 });
    expect(first.body.poll.options.map((o: any) => o.percent)).toEqual([0, 100, 0]);
    const again = await vote(ids.thread, voter, 0);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_VOTED");
    expect(again.body.poll.myVote).toBe(1);
    const second = await vote(ids.thread, voter2, 0);
    expect(second.status).toBe(201);
    expect(second.body.poll.options.map((o: any) => o.percent)).toEqual([50, 50, 0]);
    const rows = await db.select().from(postPollVotes).where(eq(postPollVotes.postId, ids.thread));
    expect(rows).toHaveLength(2);
  });

  it("rejects the author, blocked people, bad choices, guests and posts without a poll", async () => {
    const own = await vote(ids.thread, author, 0);
    expect(own.status).toBe(403);
    expect(own.body.code).toBe("AUTHOR_CANNOT_VOTE");
    expect((await vote(ids.thread, blockedUser, 0)).status).toBe(404);
    expect((await get(ids.thread, blockedUser)).status).toBe(404);
    expect((await vote(ids.cascade, voter, 0)).body.code).toBe("POLL_NOT_FOUND");
    await put(ids.cascade, author, { options: ["a", "b"] });
    for (const bad of [2, -1, 1.5, "0", null]) {
      expect((await vote(ids.cascade, voter, bad)).status, String(bad)).toBe(400);
    }
    expect((await vote(ids.cascade, null, 0)).status).toBe(401);
    expect((await vote(ids.held, voter, 0)).status).toBe(404);
  });

  it("locks the poll once anyone has voted", async () => {
    const res = await put(ids.thread, author, { options: ["x", "y"] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("POLL_LOCKED");
  });

  it("closes the poll at its end time and shows final results to everyone", async () => {
    await put(ids.ended, author, { options: ["a", "b"], durationMinutes: 60 });
    await db.insert(postPollVotes).values({ postId: ids.ended, userId: voter2, optionIndex: 0 });
    const res = await vote(ids.ended, voter, 1);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("POLL_ENDED");
    const guest = await get(ids.ended, null);
    expect(guest.body.poll).toMatchObject({ isEnded: true, showResults: true, canVote: false, winner: 0, totalVotes: 1 });
    expect(guest.body.poll.options.map((o: any) => o.percent)).toEqual([100, 0]);
  });
});

describe("batched feed lookup", () => {
  it("returns summaries only for visible posts that have a poll", async () => {
    await db.insert(postPolls).values({ postId: ids.held, options: ["a", "b"], durationMinutes: 60 }).onConflictDoNothing();
    const list = [ids.thread, ids.ended, ids.plain, ids.held, ids.draft, "junk"].join(",");
    const res = await call("GET", `/api/posts/polls?ids=${list}`, voter);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.polls).sort()).toEqual([ids.thread, ids.ended].sort());
    expect(res.body.polls[ids.thread].myVote).toBe(1);
    const authorView = await call("GET", `/api/posts/polls?ids=${list}`, author);
    expect(Object.keys(authorView.body.polls).sort()).toEqual([ids.thread, ids.ended, ids.held, ids.draft].sort());
    const blockedView = await call("GET", `/api/posts/polls?ids=${list}`, blockedUser);
    expect(blockedView.body.polls).toEqual({});
    const tooMany = Array.from({ length: 51 }, () => crypto.randomUUID()).join(",");
    expect((await call("GET", `/api/posts/polls?ids=${tooMany}`, voter)).status).toBe(400);
    expect((await call("GET", "/api/posts/polls", null)).body.polls).toEqual({});
  });
});

describe("cleanup", () => {
  it("deletes the poll and its votes with the post", async () => {
    await vote(ids.cascade, voter, 0);
    await db.delete(posts).where(eq(posts.id, ids.cascade));
    expect(await db.select().from(postPolls).where(eq(postPolls.postId, ids.cascade))).toHaveLength(0);
    expect(await db.select().from(postPollVotes).where(eq(postPollVotes.postId, ids.cascade))).toHaveLength(0);
  });
});

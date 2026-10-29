/**
 * Wave 1 audit (slice s13): social.ts, story-mentions.ts, story-highlights.ts,
 * store.ts and store-ai.ts defects found in the full read, each pinned here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or } from "drizzle-orm";
import {
  closeFriends, conversationParticipants, conversations, db, follows, messages, stories,
  storefronts, storePixels, storyHighlightItems, storyHighlights, users,
} from "@workspace/db";

const ai = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || "";
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));
vi.mock("@workspace/integrations-openai-ai-server/config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  lazyOpenAiClient: () => ({
    chat: { completions: { create: async () => {
      ai.calls += 1;
      throw new Error("401 Incorrect API key provided: sk-proj-SECRETSECRET1234");
    } } },
  }),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const id = (n: string) => `w1s13-${n}-${suffix}`;
const viewer = id("viewer");
const friendA = id("frienda");
const suspended = id("suspended");
const normal = id("normal");
const privateOwner = id("private");
const outsider = id("outsider");
const author = id("author");
const seller = id("seller");
const userIds = [viewer, friendA, suspended, normal, privateOwner, outsider, author, seller];
const handle = (u: string) => u.replace(/-/g, "_");
const sellerUsername = handle(seller);
const sellerSlug = `w1s13-${suffix}`;

let server: Server;
let base = "";
let storeRouterRef: any;

async function call(method: string, path: string, userId: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, body: parsed, text };
}

async function insertStory(values: Partial<typeof stories.$inferInsert> & { authorId: string }) {
  const [row] = await db.insert(stories).values({
    authorName: "Author", media: [{ type: "photo", imageUri: "https://img.test/s.jpg" }],
    expiresAt: new Date(Date.now() + 3600e3), ...values,
  }).returning();
  return row;
}

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: `User ${u.slice(7, 14)}`, username: handle(u),
    role: u === seller ? "seller" : "buyer", accountType: u === seller ? "seller" : "buyer",
    ...(u === suspended ? { suspendedAt: new Date() } : {}),
    ...(u === privateOwner ? { isPrivate: true } : {}),
  })));
  await db.insert(follows).values([
    { followerId: viewer, followingId: friendA },
    { followerId: friendA, followingId: suspended },
    { followerId: friendA, followingId: normal },
    { followerId: viewer, followingId: privateOwner },
    { followerId: viewer, followingId: author },
    { followerId: outsider, followingId: author },
  ]);

  const [{ default: social }, { default: mentions }, { default: highlights }, { default: store }, { default: storeAi }] = await Promise.all([
    import("../social"), import("../story-mentions"), import("../story-highlights"), import("../store"), import("../store-ai"),
  ]);
  storeRouterRef = store;
  const app = express();
  app.use(express.json());
  for (const r of [social, mentions, highlights]) app.use("/api/social", r);
  app.use("/api/store/ai", storeAi);
  app.use("/api/store", store);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const convRows = await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, userIds));
  const convIds = [...new Set(convRows.map((r) => r.id))];
  if (convIds.length) {
    await db.delete(messages).where(inArray(messages.conversationId, convIds));
    await db.delete(conversations).where(inArray(conversations.id, convIds));
  }
  await db.delete(storyHighlights).where(inArray(storyHighlights.userId, userIds));
  await db.delete(stories).where(inArray(stories.authorId, userIds));
  await db.delete(closeFriends).where(inArray(closeFriends.userId, userIds));
  await db.delete(storePixels).where(inArray(storePixels.sellerId, userIds));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("social.ts", () => {
  it("malformed post / story ids are a 404, not a Postgres uuid 500", async () => {
    expect((await call("GET", "/api/social/posts/not-a-uuid", viewer)).status).toBe(404);
    expect((await call("GET", "/api/social/stories/not-a-uuid/viewers", viewer)).status).toBe(404);
    expect((await call("DELETE", "/api/social/stories/not-a-uuid", viewer)).status).toBe(404);
    expect((await call("POST", "/api/social/stories/not-a-uuid/like", viewer, {})).status).toBe(404);
    expect((await call("POST", "/api/social/stories/not-a-uuid/view", viewer, {})).status).toBe(404);
  });

  // drizzle drops a negative .limit() entirely, so ?limit=-5 used to mean "no LIMIT".
  it("people search and suggestions clamp a negative limit and accept a repeated q", async () => {
    const search = await call("GET", "/api/social/search?q=user&limit=-5", viewer);
    expect(search.status).toBe(200);
    expect(search.body).toHaveLength(1);
    expect((await call("GET", "/api/social/search?q=user&q=other", viewer)).status).toBe(200);
    const suggested = await call("GET", "/api/social/suggested?limit=-3", viewer);
    expect(suggested.status).toBe(200);
    expect(suggested.body.map((u: any) => u.userId)).toEqual([normal]);
  });

  it("never suggests a suspended account through the mutual-follow path", async () => {
    const res = await call("GET", "/api/social/suggested?limit=50", viewer);
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((u) => u.userId);
    expect(ids).toContain(normal);
    expect(ids).not.toContain(suspended);
  });

  it("an unknown story reply permission falls back to the account default", async () => {
    const res = await call("POST", "/api/social/stories", author, {
      media: [{ type: "photo", imageUri: "https://img.test/a.jpg" }],
      privacy: { visibility: "public", replyPermission: "bogus-value" },
    });
    expect(res.status).toBe(201);
    const [row] = await db.select({ perm: stories.privacyReplyPerm }).from(stories).where(eq(stories.id, res.body.id));
    expect(row.perm).toBe("everyone");
  });
});

describe("story-mentions.ts", () => {
  it("a story held by media screening is not opened for anyone but its author", async () => {
    const held = await insertStory({ authorId: author, moderationStatus: "held" });
    expect((await call("GET", `/api/social/stories/${held.id}`, viewer)).status).toBe(404);
    expect((await call("GET", `/api/social/stories/${held.id}`, author)).status).toBe(200);
    expect((await call("POST", `/api/social/stories/${held.id}/reply`, viewer, { text: "hi" })).status).toBe(404);
  });

  it("replies honour the stored 'friends' reply permission", async () => {
    // viewer follows author, author does not follow viewer back.
    const story = await insertStory({ authorId: author, privacyReplyPerm: "friends" });
    const res = await call("POST", `/api/social/stories/${story.id}/reply`, viewer, { text: "hello" });
    expect(res.status).toBe(403);
  });

  it("a Close Friends story outside my list cannot be replied to", async () => {
    const story = await insertStory({ authorId: author, privacyVisibility: "close_friends" });
    const res = await call("POST", `/api/social/stories/${story.id}/reply`, outsider, { text: "hello" });
    expect(res.status).toBe(404);
  });

  it("mention search clamps a negative limit and accepts a repeated q", async () => {
    // viewer follows three people; limit -5 used to mean "everyone, minus the last five".
    const res = await call("GET", "/api/social/mention-search?limit=-5", viewer);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((await call("GET", "/api/social/mention-search?q=us&q=er", viewer)).status).toBe(200);
  });
});

describe("story-highlights.ts", () => {
  it("a private account's highlights are for its approved followers only", async () => {
    const [h] = await db.insert(storyHighlights).values({ userId: privateOwner, title: "Trip" }).returning();
    await db.insert(storyHighlightItems).values({
      highlightId: h.id, storyId: crypto.randomUUID(), media: [{ imageUri: "https://img.test/h.jpg" }], visibility: "public",
    });
    const asOutsider = await call("GET", `/api/social/highlights/user/${privateOwner}`, outsider);
    expect(asOutsider.status).toBe(200);
    expect(asOutsider.body).toEqual([]);
    expect((await call("GET", `/api/social/highlights/${h.id}`, outsider)).status).toBe(404);
    const asFollower = await call("GET", `/api/social/highlights/user/${privateOwner}`, viewer);
    expect(asFollower.body.map((x: any) => x.id)).toEqual([h.id]);
  });

  it("the story picker clamps a negative limit", async () => {
    await insertStory({ authorId: author });
    await insertStory({ authorId: author });
    const res = await call("GET", "/api/social/highlights/stories?limit=-1", author);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("store.ts public pages", () => {
  beforeAll(async () => {
    await db.insert(storefronts).values({
      ownerId: seller, slug: sellerSlug, title: "Shop", status: "published",
      sections: [
        null,
        "junk",
        { type: "faq", settings: { heading: "Q", faqs: [null, { q: "Real question", a: "Yes" }] } },
        { type: "customer_reviews", settings: { reviews: [null, { author: "Ann", text: "Great", rating: 5 }] } },
        { type: "social_links", settings: { socialLinks: [
          null,
          { platform: "Evil", url: "javascript:alert(document.domain)" },
          { platform: "Sneaky", url: "java\tscript:alert(1)" },
          { platform: "Insta", url: "https://instagram.com/shop" },
        ] } },
      ] as any,
    });
    await db.insert(storePixels).values({ sellerId: seller, metaPixelId: "123456789012345" });
  });

  it("renders the store when stored lists contain null entries", async () => {
    const res = await call("GET", `/api/store/site/${sellerSlug}`, "");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Real question");
    expect(res.text).toContain("Great");
  });

  it("never renders a javascript: link from a social links section", async () => {
    const res = await call("GET", `/api/store/site/${sellerSlug}`, "");
    expect(res.text).toContain('href="https://instagram.com/shop"');
    expect(res.text).not.toMatch(/href="java\s*script:/i);
    expect(res.text).not.toContain(">Evil<");
    expect(res.text).not.toContain(">Sneaky<");
  });

  it("the username and host routes honour Global Privacy Control like /site/:slug", async () => {
    const tracked = await call("GET", `/api/store/by-username/${sellerUsername}`, "");
    expect(tracked.status).toBe(200);
    expect(tracked.text).toContain("facebook.com/tr");
    const gpc = await call("GET", `/api/store/by-username/${sellerUsername}`, "", undefined, { "sec-gpc": "1" });
    expect(gpc.status).toBe(200);
    expect(gpc.text).not.toContain("facebook.com/tr");

    const host = { "x-forwarded-host": `${sellerSlug}.brandthread.app` };
    const hostTracked = await call("GET", "/api/store/host-site", "", undefined, host);
    expect(hostTracked.status).toBe(200);
    expect(hostTracked.text).toContain("facebook.com/tr");
    const hostDnt = await call("GET", "/api/store/host-site", "", undefined, { ...host, dnt: "1" });
    expect(hostDnt.text).not.toContain("facebook.com/tr");
  });

  it("has a single GET /public/:slug handler (the public projection)", () => {
    const routes = (storeRouterRef.stack as any[])
      .filter((layer) => layer.route?.path === "/public/:slug" && layer.route?.methods?.get);
    expect(routes).toHaveLength(1);
  });
});

describe("store-ai.ts", () => {
  it("does not send provider error text to the client", async () => {
    const before = ai.calls;
    const res = await call("POST", "/api/store/ai/from-logo", seller, { base64: "iVBORw0KGgo=" });
    expect(ai.calls).toBe(before + 1);
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("SECRETSECRET");
    expect(res.text).not.toContain("API key");
  });

  it("rejects non-string images with a 400", async () => {
    expect((await call("POST", "/api/store/ai/from-logo", seller, { base64: 123 })).status).toBe(400);
    expect((await call("POST", "/api/store/ai/from-moodboard", seller, { base64List: [1, 2] })).status).toBe(400);
  });
});

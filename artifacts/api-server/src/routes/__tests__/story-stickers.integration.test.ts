import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or } from "drizzle-orm";
import {
  blocks, conversationParticipants, conversations, db, dropAlertSubscriptions, drops, follows, messages,
  productVariants, products, stories, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const published = vi.hoisted(() => ({ calls: [] as any[] }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: any) => { published.calls.push(n); },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `ss-${n}-${suffix}`;
const author = id("author");     // seller
const other = id("otherseller");
const fan = id("fan");           // follows the author
const fan2 = id("fan2");         // follows the author
const outsider = id("outsider"); // follows nobody
const blockedFan = id("blocked");// follows the author but is blocked by them
const buyerAuthor = id("buyerauthor");
const userIds = [author, other, fan, fan2, outsider, blockedFan, buyerAuthor];
const handle = (u: string) => u.replace(/-/g, "_");

let server: Server;
let base = "";
let productId = "";
let archivedProductId = "";
let dropId = "";
let otherDropId = "";
let pastDropId = "";
const skus: string[] = [];

async function req(path: string, userId: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const get = (p: string, u: string) => req(p, u);
const post = (p: string, u: string, body: unknown) => req(p, u, { method: "POST", body: JSON.stringify(body) });

const pollSticker = (extra: Record<string, unknown> = {}) => ({
  id: "poll1", type: "poll", x: 40, y: 200, pollQuestion: "Black or white?",
  pollOptions: [{ label: "Black", votes: 50 }, { label: "White", votes: 50 }], ...extra,
});
const questionSticker = (extra: Record<string, unknown> = {}) => ({ id: "q1", type: "question", x: 40, y: 300, questionPrompt: "Ask me anything", ...extra });
const photo = (overlays: unknown[]) => ({ type: "photo", imageUri: "https://img.test/s.jpg", overlays });
const createStory = (userId: string, overlays: unknown[], extra: Record<string, unknown> = {}) =>
  post("/api/social/stories", userId, { media: [photo(overlays)], ...extra });
const overlaysOf = (story: any) => story.media[0].overlays as any[];

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: `User ${u.slice(3, 9)}`, username: handle(u),
    role: u === author || u === other ? "seller" : "buyer", accountType: u === author || u === other ? "seller" : "buyer",
  })));
  await db.insert(follows).values([fan, fan2, blockedFan, buyerAuthor].map((f) => ({ followerId: f, followingId: author })).concat([{ followerId: fan, followingId: buyerAuthor }]));
  await db.insert(blocks).values({ blockerId: author, blockedId: blockedFan });

  const [p] = await db.insert(products).values({ ownerId: author, name: "Silver Tee", status: "active", images: ["https://img.test/tee.jpg"] }).returning();
  productId = p.id;
  const [a] = await db.insert(products).values({ ownerId: author, name: "Old Tee", status: "archived", images: [] }).returning();
  archivedProductId = a.id;
  for (const [pid, price, stock] of [[productId, 5200, 3], [productId, 4200, 0], [archivedProductId, 100, 1]] as const) {
    const sku = `sku-${crypto.randomUUID()}`;
    skus.push(sku);
    await db.insert(productVariants).values({ productId: pid, sku, priceCents: price, stock });
  }
  const soon = new Date(Date.now() + 2 * 3600e3);
  const [d1] = await db.insert(drops).values({ ownerId: author, name: "Autumn Drop", type: "pre-made", status: "active", releaseAt: soon }).returning();
  const [d2] = await db.insert(drops).values({ ownerId: other, name: "Not mine", type: "pre-made", status: "active", releaseAt: soon }).returning();
  const [d3] = await db.insert(drops).values({ ownerId: author, name: "Already out", type: "pre-made", status: "active", releaseAt: new Date(Date.now() - 3600e3) }).returning();
  dropId = d1.id; otherDropId = d2.id; pastDropId = d3.id;

  const [{ default: social }, { default: mentions }, { default: stickers }, { default: convs }] = await Promise.all([
    import("../social"), import("../story-mentions"), import("../story-stickers"), import("../conversations"),
  ]);
  const app = express();
  app.use(express.json());
  for (const r of [social, mentions, stickers]) app.use("/api/social", r);
  app.use("/api/conversations", convs);
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
  await db.delete(stories).where(inArray(stories.authorId, userIds));
  await db.delete(drops).where(inArray(drops.ownerId, userIds));
  await db.delete(products).where(inArray(products.ownerId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => { published.calls.length = 0; });

describe("POST /stories sticker sanitising", () => {
  it("keeps valid stickers, rebuilds product / drop facts from the server and drops everything else", async () => {
    const res = await createStory(author, [
      { id: "t1", type: "text", x: 1, y: 2, text: "hello", color: "#fff", evil: "<script>", nested: { a: 1 } },
      pollSticker({ id: "pollA" }),
      pollSticker({ id: "pollB" }), // second poll on the slide is dropped
      questionSticker(),
      { id: "prod", type: "product", x: 5, y: 5, productId, productName: "FAKE", productPriceCents: 1 },
      { id: "prodGone", type: "product", x: 5, y: 5, productId: crypto.randomUUID() },
      { id: "prodArchived", type: "product", x: 5, y: 5, productId: archivedProductId },
      { id: "cd", type: "countdown", x: 5, y: 5, dropId, dropName: "FAKE" },
      { id: "badType", type: "iframe", x: 1, y: 1 },
      { id: "badPoll", type: "poll", pollQuestion: "one option", pollOptions: ["x"] },
    ]);
    expect(res.status).toBe(201);
    const ovs = overlaysOf(res.body);
    expect(ovs.map((o) => o.id)).toEqual(["t1", "pollA", "q1", "prod", "cd"]);
    expect(ovs[0]).not.toHaveProperty("evil");
    expect(ovs[0]).not.toHaveProperty("nested");
    expect(ovs[1].pollOptions).toEqual([{ label: "Black", votes: 0 }, { label: "White", votes: 0 }]);
    expect(ovs[3]).toMatchObject({ productId, productName: "Silver Tee", productPriceCents: 4200, productImageUri: "https://img.test/tee.jpg" });
    expect(ovs[4]).toMatchObject({ dropId, dropName: "Autumn Drop" });
    expect(new Date(ovs[4].dropReleaseAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("countdown only for a seller's own upcoming drop", async () => {
    const res = await createStory(author, [
      { id: "c1", type: "countdown", dropId: otherDropId },
      { id: "c2", type: "countdown", dropId: pastDropId },
      { id: "c3", type: "countdown", dropId: crypto.randomUUID() },
    ]);
    expect(overlaysOf(res.body)).toEqual([]);
    const buyer = await createStory(buyerAuthor, [{ id: "c4", type: "countdown", dropId }]);
    expect(overlaysOf(buyer.body)).toEqual([]);
  });

  it("caps stickers per slide and keeps overlay ids unique", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: "same", type: "location", x: i, y: i, locationLabel: `L${i}` }));
    const res = await createStory(author, many);
    const ovs = overlaysOf(res.body);
    expect(ovs).toHaveLength(12);
    expect(new Set(ovs.map((o) => o.id)).size).toBe(12);
  });

  it("rejects hateful poll or question text like any other story text", async () => {
    const q = await createStory(author, [questionSticker({ questionPrompt: "I'm going to kill you" })]);
    expect(q.status).toBe(422);
    expect(q.body.code).toBe("CONTENT_REJECTED");
    const p = await createStory(author, [pollSticker({ pollOptions: ["fine", "i know where you live"] })]);
    expect(p.status).toBe(422);
  });
});

describe("polls", () => {
  let storyId = "";
  beforeAll(async () => { storyId = (await createStory(author, [pollSticker()])).body.id; });
  const state = async (u: string) => (await get(`/api/social/stories/${storyId}`, u)).body.stickerState.polls.poll1;

  it("hides results until you vote; the author always sees them", async () => {
    expect(await state(fan)).toEqual({ counts: null, percentages: null, total: null, myVote: null });
    expect((await state(author)).counts).toEqual([0, 0]);
  });

  it("records one vote per viewer and returns the results", async () => {
    const v = await post(`/api/social/stories/${storyId}/poll-vote`, fan, { overlayId: "poll1", optionIndex: 1 });
    expect(v.status).toBe(201);
    expect(v.body.stickerState.polls.poll1).toMatchObject({ counts: [0, 1], percentages: [0, 100], total: 1, myVote: 1 });
    const again = await post(`/api/social/stories/${storyId}/poll-vote`, fan, { overlayId: "poll1", optionIndex: 0 });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_VOTED");
    expect(again.body.stickerState.polls.poll1.myVote).toBe(1);

    await post(`/api/social/stories/${storyId}/poll-vote`, fan2, { overlayId: "poll1", optionIndex: 0 });
    expect(await state(author)).toMatchObject({ counts: [1, 1], percentages: [50, 50], total: 2 });
    expect(await state(fan2)).toMatchObject({ counts: [1, 1], myVote: 0 });
  });

  it("refuses the author, strangers, blocked people and bad input", async () => {
    const vote = (u: string, body: unknown) => post(`/api/social/stories/${storyId}/poll-vote`, u, body);
    expect((await vote(author, { overlayId: "poll1", optionIndex: 0 })).status).toBe(403);
    expect((await vote(outsider, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);
    expect((await vote(blockedFan, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);
    expect((await vote(outsider, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);
    expect((await vote(buyerAuthor, { overlayId: "poll1", optionIndex: 9 })).status).toBe(400);
    expect((await vote(buyerAuthor, { overlayId: "poll1", optionIndex: "0" })).status).toBe(400);
    expect((await vote(buyerAuthor, { overlayId: "nope", optionIndex: 0 })).status).toBe(404);
    expect((await vote(buyerAuthor, { overlayId: "poll1", optionIndex: 0 })).status).toBe(201);
    expect((await post(`/api/social/stories/${crypto.randomUUID()}/poll-vote`, fan, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);
  });

  it("is closed once the story expires and for Close Friends stories the viewer is not on", async () => {
    const exp = (await createStory(author, [pollSticker()])).body.id;
    await db.update(stories).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(stories.id, exp));
    expect((await post(`/api/social/stories/${exp}/poll-vote`, fan, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);

    const cf = (await createStory(author, [pollSticker()])).body.id;
    await db.update(stories).set({ privacyVisibility: "close_friends" }).where(eq(stories.id, cf));
    expect((await post(`/api/social/stories/${cf}/poll-vote`, fan, { overlayId: "poll1", optionIndex: 0 })).status).toBe(404);
  });
});

describe("questions", () => {
  let storyId = "";
  beforeAll(async () => { storyId = (await createStory(author, [questionSticker()])).body.id; });
  const answer = (u: string, body: unknown) => post(`/api/social/stories/${storyId}/question-answer`, u, body);

  it("stores one answer per person, tells the author once, and shows only counts to the author", async () => {
    const ok = await answer(fan, { overlayId: "q1", answer: "  Silver, always.  " });
    expect(ok.status).toBe(201);
    expect(ok.body.stickerState.questions.q1).toEqual({ answered: true, count: null });
    const dupe = await answer(fan, { overlayId: "q1", answer: "again" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe("ALREADY_ANSWERED");
    await answer(fan2, { overlayId: "q1", answer: "Black" });

    await vi.waitFor(() => expect(published.calls.filter((c) => c.userId === author && c.type === "story_reply")).toHaveLength(2));
    const note = published.calls.find((c) => c.actorId === fan)!;
    expect(note).toMatchObject({ targetId: storyId, targetType: "story" });
    expect(note.title).toContain("answered your question");

    const asAuthor = (await get(`/api/social/stories/${storyId}`, author)).body.stickerState.questions.q1;
    expect(asAuthor).toEqual({ answered: false, count: 2 });
  });

  it("refuses the author, strangers, blocked people, empty / long / abusive answers", async () => {
    expect((await answer(author, { overlayId: "q1", answer: "me" })).status).toBe(403);
    expect((await answer(outsider, { overlayId: "q1", answer: "hi" })).status).toBe(404);
    expect((await answer(blockedFan, { overlayId: "q1", answer: "hi" })).status).toBe(404);
    expect((await answer(buyerAuthor, { overlayId: "q1", answer: "   " })).status).toBe(400);
    expect((await answer(buyerAuthor, { overlayId: "q1", answer: "x".repeat(201) })).status).toBe(400);
    expect((await answer(buyerAuthor, { overlayId: "missing", answer: "hi" })).status).toBe(404);
    expect(await db.select().from(stories).where(eq(stories.id, storyId))).toHaveLength(1);
  });

  it("only the author reads the answers (blocked answerers are hidden) and can open a reply DM", async () => {
    expect((await get(`/api/social/stories/${storyId}/question-answers`, fan)).status).toBe(403);
    const list = await get(`/api/social/stories/${storyId}/question-answers`, author);
    expect(list.status).toBe(200);
    expect(list.body.questions[0].prompt).toBe("Ask me anything");
    expect(list.body.questions[0].answers.map((a: any) => [a.userId, a.answer]).sort()).toEqual([[fan, "Silver, always."], [fan2, "Black"]].sort());

    const dm = await post(`/api/social/stories/${storyId}/question-reply-conversation`, author, { userId: fan });
    expect(dm.status).toBe(200);
    expect(dm.body.conversationId).toBeTruthy();
    expect((await post(`/api/social/stories/${storyId}/question-reply-conversation`, fan, { userId: fan2 })).status).toBe(403);
    expect((await post(`/api/social/stories/${storyId}/question-reply-conversation`, author, { userId: outsider })).status).toBe(404);

    await db.insert(blocks).values({ blockerId: author, blockedId: fan2 });
    const after = await get(`/api/social/stories/${storyId}/question-answers`, author);
    expect(after.body.questions[0].answers.map((a: any) => a.userId)).toEqual([fan]);
    await db.delete(blocks).where(eq(blocks.blockedId, fan2));
  });
});

describe("product and countdown state", () => {
  it("returns live product facts and drop state, with Notify me reflecting the existing subscription", async () => {
    const created = await createStory(author, [
      { id: "prod", type: "product", x: 1, y: 1, productId },
      { id: "cd", type: "countdown", x: 1, y: 1, dropId },
    ]);
    const sid = created.body.id;
    const first = (await get(`/api/social/stories/${sid}`, fan)).body.stickerState;
    expect(first.products.prod).toMatchObject({ productId, name: "Silver Tee", priceCents: 4200, available: true, soldOut: false });
    expect(first.countdowns.cd).toMatchObject({ dropId, name: "Autumn Drop", launched: false, live: false, subscribed: false });
    expect(first.serverNow).toBeGreaterThan(0);

    await db.insert(dropAlertSubscriptions).values({ dropId, userId: fan });
    expect((await get(`/api/social/stories/${sid}`, fan)).body.stickerState.countdowns.cd.subscribed).toBe(true);
    expect((await get(`/api/social/stories/${sid}`, fan2)).body.stickerState.countdowns.cd.subscribed).toBe(false);

    // The product disappears / the drop launches after posting: viewers see the truth, not the snapshot.
    await db.update(products).set({ status: "archived" }).where(eq(products.id, productId));
    await db.update(drops).set({ releaseAt: new Date(Date.now() - 1000) }).where(eq(drops.id, dropId));
    const later = (await get(`/api/social/stories/${sid}`, fan)).body.stickerState;
    expect(later.products.prod.available).toBe(false);
    expect(later.countdowns.cd).toMatchObject({ launched: true, live: true });
    await db.update(products).set({ status: "active" }).where(eq(products.id, productId));
  });

  it("stories without stickers carry stickerState: null and the field is on every list endpoint", async () => {
    const plain = await createStory(author, []);
    expect(plain.body.stickerState).toBeNull();
    const withPoll = await createStory(author, [pollSticker()]);
    const mine = await get("/api/social/stories/me", author);
    expect(mine.body.find((s: any) => s.id === withPoll.body.id).stickerState.polls.poll1.counts).toEqual([0, 0]);
    const theirs = await get(`/api/social/stories/user/${author}`, fan);
    expect(theirs.body.find((s: any) => s.id === withPoll.body.id).stickerState.polls.poll1.counts).toBeNull();
  });
});

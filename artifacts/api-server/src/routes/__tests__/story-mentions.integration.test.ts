import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or } from "drizzle-orm";
import {
  blocks, conversationParticipants, conversations, db, follows, messages, orders, stories, storyMentions, users,
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
const id = (n: string) => `sm-${n}-${suffix}`;
const buyer = id("buyer");        // tags the seller
const seller = id("seller");      // tagged
const friend = id("friend");      // tagged, follows-back scenario
const stranger = id("stranger");  // never tagged
const blockedUser = id("blocked");
const userIds = [buyer, seller, friend, stranger, blockedUser];
const handle = (u: string) => u.replace(/-/g, "_");

let server: Server;
let base = "";

async function req(path: string, userId: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const post = (path: string, userId: string, body: unknown) =>
  req(path, userId, { method: "POST", body: JSON.stringify(body) });

const mentionSticker = (userId: string, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), type: "mention", x: 40, y: 80, scale: 1, rotation: 0,
  mentionUserId: userId, mentionHandle: `@${handle(userId)}`, ...extra,
});
const photo = (overlays: unknown[] = []) => ({ type: "photo", imageUri: "https://img.test/piece.jpg", overlays });

async function createStory(author: string, overlays: unknown[], extra: Record<string, unknown> = {}) {
  return post("/api/social/stories", author, { media: [photo(overlays)], ...extra });
}
const notesFor = (userId: string, type: string) => published.calls.filter((c) => c.userId === userId && c.type === type);

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Buyer B", username: handle(buyer), role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@t.local`, name: "Seller S", username: handle(seller), role: "seller", accountType: "seller" },
    { clerkId: friend, email: `${friend}@t.local`, name: "Friend F", username: handle(friend), role: "buyer", accountType: "buyer" },
    { clerkId: stranger, email: `${stranger}@t.local`, name: "Stranger X", username: handle(stranger), role: "buyer", accountType: "buyer" },
    { clerkId: blockedUser, email: `${blockedUser}@t.local`, name: "Blocked Y", username: handle(blockedUser), role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(blocks).values({ blockerId: buyer, blockedId: blockedUser });
  const [{ default: social }, { default: mentions }, { default: convs }] = await Promise.all([
    import("../social"), import("../story-mentions"), import("../conversations"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/social", social);
  app.use("/api/social", mentions);
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
  await db.delete(orders).where(inArray(orders.ownerId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(() => { published.calls.length = 0; });

describe("story mentions", () => {
  it("tag → stored mention with sticker placement → Activity notification with thumbnail", async () => {
    const res = await createStory(buyer, [mentionSticker(seller, { scale: 1.5, rotation: 12, mentionStyle: "neon" })]);
    expect(res.status).toBe(201);
    const [row] = await db.select().from(storyMentions).where(eq(storyMentions.storyId, res.body.id));
    expect(row.mentionedUserId).toBe(seller);
    expect(row.taggerId).toBe(buyer);
    expect(row.sticker).toMatchObject({ slide: 0, x: 40, y: 80, scale: 1.5, rotation: 12, style: "neon", source: "sticker" });

    await vi.waitFor(() => expect(notesFor(seller, "story_mention")).toHaveLength(1));
    const note = notesFor(seller, "story_mention")[0];
    expect(note.title).toBe(`@${handle(buyer)} mentioned you in their story`);
    expect(note).toMatchObject({ category: "social", targetId: res.body.id, targetType: "story", targetImageUrl: "https://img.test/piece.jpg", actorId: buyer });
  });

  it("supports several mentions per story and '@name' typed in the text tool", async () => {
    const res = await createStory(buyer, [
      mentionSticker(seller),
      mentionSticker(friend),
      { id: crypto.randomUUID(), type: "text", text: `so good @${handle(stranger)}!`, x: 0, y: 0 },
    ]);
    const rows = await db.select().from(storyMentions).where(eq(storyMentions.storyId, res.body.id));
    expect(rows.map((r) => r.mentionedUserId).sort()).toEqual([seller, friend, stranger].sort());
    expect(rows.find((r) => r.mentionedUserId === stranger)!.sticker).toMatchObject({ source: "text" });
    // Let the fire-and-forget notifications land so they can't leak into the next test.
    await vi.waitFor(() => expect(published.calls.filter((c) => c.type === "story_mention")).toHaveLength(3));
  });

  it("silently drops self, blocked and unknown users (sticker removed, no notification)", async () => {
    const res = await createStory(buyer, [mentionSticker(buyer), mentionSticker(blockedUser), mentionSticker("nobody-" + suffix)]);
    expect(res.status).toBe(201);
    expect(res.body.media[0].overlays).toEqual([]);
    expect(await db.select().from(storyMentions).where(eq(storyMentions.storyId, res.body.id))).toHaveLength(0);
    // Blocked in the other direction too.
    const res2 = await createStory(blockedUser, [mentionSticker(buyer)]);
    expect(res2.status).toBe(201);
    expect(await db.select().from(storyMentions).where(eq(storyMentions.storyId, res2.body.id))).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(published.calls.filter((c) => c.type === "story_mention")).toHaveLength(0);
  });

  it("a sticker pinched to scale 0.05 and parked in the corner still registers (mention row + notification)", async () => {
    const res = await createStory(buyer, [mentionSticker(seller, { scale: 0.05, x: 388, y: 846, opacity: 0.1 })]);
    expect(res.status).toBe(201);
    const [row] = await db.select().from(storyMentions).where(eq(storyMentions.storyId, res.body.id));
    expect(row.mentionedUserId).toBe(seller);
    expect(row.sticker).toMatchObject({ scale: 0.05, x: 388, y: 846, opacity: 0.1 });
    // The overlay is kept as-is so viewers can still tap the hidden spot.
    expect(res.body.media[0].overlays[0]).toMatchObject({ scale: 0.05, x: 388, y: 846, mentionUserId: seller });
    await vi.waitFor(() => expect(notesFor(seller, "story_mention")).toHaveLength(1));
    const rail = await req("/api/social/stories/mentions", seller);
    expect(rail.body.items.map((i: any) => i.storyId)).toContain(res.body.id);
  });

  it("the rail lists active tagging stories newest first, only for the tagged person", async () => {
    await db.delete(stories).where(inArray(stories.authorId, userIds));
    const a = await createStory(buyer, [mentionSticker(seller)]);
    await new Promise((r) => setTimeout(r, 15));
    const b = await createStory(friend, [mentionSticker(seller)]);
    const c = await createStory(buyer, [mentionSticker(friend)]);
    const rail = await req("/api/social/stories/mentions", seller);
    expect(rail.status).toBe(200);
    expect(rail.body.items.map((i: any) => i.storyId)).toEqual([b.body.id, a.body.id]);
    expect(rail.body.items[0]).toMatchObject({ seen: false, handled: false, tagger: { userId: friend } });
    expect(rail.body.unseenCount).toBe(2);
    expect((await req("/api/social/stories/mentions", stranger)).body.items).toHaveLength(0);
    expect(c.status).toBe(201);

    // Viewing marks it seen (white ring → seen).
    await post(`/api/social/stories/${a.body.id}/view`, seller, {});
    const after = await req("/api/social/stories/mentions", seller);
    expect(after.body.items.find((i: any) => i.storyId === a.body.id).seen).toBe(true);
    expect(after.body.unseenCount).toBe(1);

    // Expired and deleted stories drop off; blocked taggers are hidden.
    await db.update(stories).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(stories.id, a.body.id));
    await req(`/api/social/stories/${b.body.id}`, friend, { method: "DELETE" });
    expect((await req("/api/social/stories/mentions", seller)).body.items).toHaveLength(0);
  });

  it("a tagged person can open a story they don't follow; strangers can't", async () => {
    const s = await createStory(buyer, [mentionSticker(seller)]);
    expect((await req(`/api/social/stories/${s.body.id}`, seller)).status).toBe(200);
    const denied = await req(`/api/social/stories/${s.body.id}`, stranger);
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("STORY_UNAVAILABLE");
  });

  it("people picker lists people I follow first, then everyone, excluding blocked", async () => {
    await db.insert(follows).values({ followerId: buyer, followingId: friend }).onConflictDoNothing();
    const res = await req(`/api/social/mention-search?q=${encodeURIComponent(suffix)}`, buyer);
    const ids = res.body.map((p: any) => p.userId);
    expect(ids[0]).toBe(friend);
    expect(res.body[0].isFollowing).toBe(true);
    expect(ids).not.toContain(blockedUser);
    expect(ids).not.toContain(buyer);
    const empty = await req("/api/social/mention-search?q=", buyer);
    expect(empty.body.map((p: any) => p.userId)).toEqual([friend]);
  });

  describe("reply routing", () => {
    it("goes to Requests when the recipient doesn't follow the sender", async () => {
      const s = await createStory(buyer, [mentionSticker(stranger)]);
      const r = await post(`/api/social/stories/${s.body.id}/mention-reply`, stranger, {});
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ route: "requests", isRequest: true, requestedBy: stranger });
    });

    it("goes to the main inbox when the recipient follows the sender", async () => {
      await db.insert(follows).values({ followerId: buyer, followingId: friend }).onConflictDoNothing();
      const s = await createStory(buyer, [mentionSticker(friend)]);
      const r = await post(`/api/social/stories/${s.body.id}/mention-reply`, friend, {});
      expect(r.body).toMatchObject({ route: "inbox", isRequest: false });
      // Reuses the same conversation and accepts the message through the normal endpoint.
      const again = await post(`/api/social/stories/${s.body.id}/mention-reply`, friend, {});
      expect(again.body.conversationId).toBe(r.body.conversationId);
      const sent = await post(`/api/conversations/${r.body.conversationId}/messages`, friend, {
        text: "love this!", attachment: { type: "story_reply", uri: "https://img.test/piece.jpg", title: "Replied to your story", meta: { storyId: s.body.id } },
      });
      expect(sent.status).toBe(201);
    });

    it("goes to the inbox when the recipient is a seller and the sender has a paid order with them", async () => {
      // The seller tags the buyer; the buyer's reply goes buyer → seller.
      const s = await createStory(seller, [mentionSticker(buyer)]);
      await db.insert(orders).values({
        ownerId: seller, buyerId: buyer, orderNumber: `O-${suffix}-1`, status: "pending", totalCents: 100, subtotalCents: 100,
      });
      const unpaid = await post(`/api/social/stories/${s.body.id}/mention-reply`, buyer, {});
      expect(unpaid.body.route).toBe("requests"); // an unpaid order doesn't count
      await db.delete(conversations).where(eq(conversations.id, unpaid.body.conversationId));

      await db.update(orders).set({ paidAt: new Date(), status: "processing" }).where(eq(orders.orderNumber, `O-${suffix}-1`));
      const paid = await post(`/api/social/stories/${s.body.id}/mention-reply`, buyer, {});
      expect(paid.body).toMatchObject({ route: "inbox", isRequest: false });
    });

    it("rejects replies from people who weren't tagged", async () => {
      const s = await createStory(buyer, [mentionSticker(seller)]);
      expect((await post(`/api/social/stories/${s.body.id}/mention-reply`, stranger, {})).status).toBe(403);
    });
  });

  describe("reshare (Add to your story)", () => {
    it("only the tagged person can reshare; credit + Activity item for the original author", async () => {
      const original = await createStory(buyer, [mentionSticker(seller)]);
      const card = { type: "text", bg: "#111111", overlays: [{ id: "c", type: "reshare_card", x: 0, y: 0, imageUri: "https://img.test/piece.jpg" }] };

      const denied = await post("/api/social/stories", stranger, { media: [card], originalStoryId: original.body.id });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("NOT_TAGGED");

      const ok = await post("/api/social/stories", seller, { media: [card], originalStoryId: original.body.id });
      expect(ok.status).toBe(201);
      expect(ok.body.original).toMatchObject({ storyId: original.body.id, authorId: buyer, authorHandle: `@${handle(buyer)}`, available: true });

      await vi.waitFor(() => expect(notesFor(buyer, "story_reshare")).toHaveLength(1));
      expect(notesFor(buyer, "story_reshare")[0].title).toBe(`@${handle(seller)} shared your story`);

      const rail = await req("/api/social/stories/mentions", seller);
      expect(rail.body.items.find((i: any) => i.storyId === original.body.id)).toMatchObject({ handled: true, handledAction: "reshared" });

      // Original deleted → the reshare reads "Story unavailable" and the rail entry is gone.
      await req(`/api/social/stories/${original.body.id}`, buyer, { method: "DELETE" });
      const mine = await req("/api/social/stories/me", seller);
      expect(mine.body.find((s: any) => s.id === ok.body.id).original).toMatchObject({ available: false, authorHandle: `@${handle(buyer)}` });
      expect((await req("/api/social/stories/mentions", seller)).body.items.find((i: any) => i.storyId === original.body.id)).toBeUndefined();
    });

    it("refuses to reshare an expired original; 'Not now' marks it handled", async () => {
      const original = await createStory(buyer, [mentionSticker(seller)]);
      const dismissed = await post(`/api/social/stories/${original.body.id}/mention-dismiss`, seller, {});
      expect(dismissed.status).toBe(200);
      const rail = await req("/api/social/stories/mentions", seller);
      expect(rail.body.items.find((i: any) => i.storyId === original.body.id)).toMatchObject({ handled: true, handledAction: "dismissed" });
      expect((await post(`/api/social/stories/${original.body.id}/mention-dismiss`, stranger, {})).status).toBe(404);

      await db.update(stories).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(stories.id, original.body.id));
      const late = await post("/api/social/stories", seller, { media: [{ type: "text", bg: "#000", overlays: [] }], originalStoryId: original.body.id });
      expect(late.status).toBe(410);
      expect(late.body.code).toBe("STORY_UNAVAILABLE");
    });
  });
});

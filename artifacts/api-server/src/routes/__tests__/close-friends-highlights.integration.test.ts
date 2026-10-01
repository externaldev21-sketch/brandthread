import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or } from "drizzle-orm";
import {
  blocks, closeFriends, db, follows, stories, storyArchive, storyHighlights, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `ch-${n}-${suffix}`;
const author = id("author");
const cf = id("cf");             // on the close friends list, follows author
const follower = id("follower"); // follows author, NOT on the list
const mutual = id("mutual");     // mutual follow with the author, NOT on the list
const outsider = id("outsider"); // follows nobody
const blockedUser = id("blocked");
const userIds = [author, cf, follower, mutual, outsider, blockedUser];
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
const get = (p: string, u: string) => req(p, u);
const send = (method: string, p: string, u: string, body?: unknown) =>
  req(p, u, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const photo = (uri = "https://img.test/story.jpg") => ({ type: "photo", imageUri: uri, overlays: [] });

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: `User ${u.slice(3, 10)}`, username: handle(u), role: "buyer", accountType: "buyer",
  })));
  await db.insert(follows).values([
    { followerId: cf, followingId: author },
    { followerId: follower, followingId: author },
    { followerId: mutual, followingId: author },
    { followerId: author, followingId: mutual },
    { followerId: blockedUser, followingId: author },
  ]);
  await db.insert(blocks).values({ blockerId: author, blockedId: blockedUser });
  const [{ default: social }, { default: mentions }, { default: cfRouter }, { default: hl }] = await Promise.all([
    import("../social"), import("../story-mentions"), import("../close-friends"), import("../story-highlights"),
  ]);
  const app = express();
  app.use(express.json());
  for (const r of [social, mentions, cfRouter, hl]) app.use("/api/social", r);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const hls = await db.select({ id: storyHighlights.id }).from(storyHighlights).where(inArray(storyHighlights.userId, userIds));
  if (hls.length) await db.delete(storyHighlights).where(inArray(storyHighlights.id, hls.map((h) => h.id)));
  await db.delete(storyArchive).where(inArray(storyArchive.authorId, userIds));
  await db.delete(stories).where(inArray(stories.authorId, userIds));
  await db.delete(closeFriends).where(or(inArray(closeFriends.userId, userIds), inArray(closeFriends.friendId, userIds)));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("close friends list", () => {
  it("only accepts people in my follow graph, never self or blocked; PUT replaces the set", async () => {
    const res = await send("PUT", "/api/social/close-friends", author, {
      userIds: [cf, author, blockedUser, outsider, "ghost-" + suffix, cf],
    });
    expect(res.status).toBe(200);
    expect(res.body.userIds).toEqual([cf]);
    expect(res.body.rejected.sort()).toEqual([blockedUser, outsider, "ghost-" + suffix].sort());
    expect((await get("/api/social/close-friends", author)).body.userIds).toEqual([cf]);

    const swap = await send("PUT", "/api/social/close-friends", author, { userIds: [cf, follower] });
    expect(swap.body.userIds.sort()).toEqual([cf, follower].sort());
    const shrink = await send("PUT", "/api/social/close-friends", author, { userIds: [cf] });
    expect(shrink.body.userIds).toEqual([cf]);
    // other users' lists are independent
    expect((await get("/api/social/close-friends", cf)).body.userIds).toEqual([]);
  });

  it("validates the payload and the 500 cap", async () => {
    expect((await send("PUT", "/api/social/close-friends", author, { userIds: "x" })).status).toBe(400);
    expect((await send("PUT", "/api/social/close-friends", author, { userIds: [1] })).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => `u-${i}`);
    const res = await send("PUT", "/api/social/close-friends", author, { userIds: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CLOSE_FRIENDS_LIMIT");
  });

  it("drops a blocked friend from the list response", async () => {
    await db.insert(closeFriends).values({ userId: author, friendId: blockedUser }).onConflictDoNothing();
    expect((await get("/api/social/close-friends", author)).body.userIds).toEqual([cf]);
    await db.delete(closeFriends).where(eq(closeFriends.friendId, blockedUser));
  });
});

describe("Close Friends stories do not leak", () => {
  let cfStory = "";
  let pubStory = "";
  let friendsStory = "";

  it("stores closeFriendsOnly as close_friends and reports it back", async () => {
    await send("PUT", "/api/social/close-friends", author, { userIds: [cf] });
    const a = await send("POST", "/api/social/stories", author, { media: [photo()], privacy: { visibility: "public", closeFriendsOnly: true } });
    expect(a.status).toBe(201);
    expect(a.body.privacy.closeFriendsOnly).toBe(true);
    cfStory = a.body.id;
    const [row] = await db.select().from(stories).where(eq(stories.id, cfStory));
    expect(row.privacyVisibility).toBe("close_friends");
    const b = await send("POST", "/api/social/stories", author, { media: [photo()], privacy: { visibility: "public" } });
    pubStory = b.body.id;
    expect(b.body.privacy.closeFriendsOnly).toBe(false);
    const c = await send("POST", "/api/social/stories", author, { media: [photo()], privacy: { visibility: "friends" } });
    friendsStory = c.body.id;
  });

  it("/stories/user/:id returns it to the author and list members only", async () => {
    const ids = async (u: string) => (await get(`/api/social/stories/user/${author}`, u)).body.map((s: any) => s.id).sort();
    expect(await ids(author)).toEqual([cfStory, pubStory, friendsStory].sort());
    expect(await ids(cf)).toEqual([cfStory, pubStory].sort());
    expect(await ids(follower)).toEqual([pubStory]);
    expect(await ids(mutual)).toEqual([pubStory, friendsStory].sort());
    expect(await ids(outsider)).toEqual([]);
    expect(await ids(blockedUser)).toEqual([]);
  });

  it("/stories/following tray hides it from non-members and includes mutual-follow stories", async () => {
    const entry = async (u: string) => (await get("/api/social/stories/following", u)).body.find((e: any) => e.authorId === author);
    expect(await entry(cf)).toMatchObject({ storyIds: expect.arrayContaining([cfStory, pubStory]), closeFriendsOnly: true });
    const f = await entry(follower);
    expect(f.storyIds).toEqual([pubStory]);
    expect(f.closeFriendsOnly).toBe(false);
    const m = await entry(mutual);
    expect(m.storyIds.sort()).toEqual([pubStory, friendsStory].sort());
  });

  it("/stories/:id, like, view and viewers enforce the audience", async () => {
    expect((await get(`/api/social/stories/${cfStory}`, author)).status).toBe(200);
    expect((await get(`/api/social/stories/${cfStory}`, cf)).body.privacy.closeFriendsOnly).toBe(true);
    expect((await get(`/api/social/stories/${cfStory}`, follower)).status).toBe(404);
    expect((await get(`/api/social/stories/${cfStory}`, mutual)).status).toBe(404);
    expect((await get(`/api/social/stories/${cfStory}`, outsider)).status).toBe(404);
    expect((await get(`/api/social/stories/${pubStory}`, follower)).status).toBe(200);

    expect((await send("POST", `/api/social/stories/${cfStory}/like`, follower)).status).toBe(404);
    expect((await send("POST", `/api/social/stories/${cfStory}/view`, follower)).status).toBe(404);
    expect((await send("POST", `/api/social/stories/${cfStory}/like`, cf)).body.liked).toBe(true);
    expect((await send("POST", `/api/social/stories/${cfStory}/view`, cf)).status).toBe(200);
    expect((await send("POST", `/api/social/stories/${friendsStory}/view`, follower)).status).toBe(404);
    expect((await send("POST", `/api/social/stories/${friendsStory}/view`, mutual)).status).toBe(200);

    expect((await get(`/api/social/stories/${cfStory}/viewers`, follower)).status).toBe(403);
    const viewers = await get(`/api/social/stories/${cfStory}/viewers`, author);
    expect(viewers.body.map((v: any) => v.userId)).toEqual([cf]);
  });

  it("removing someone from the list revokes access immediately", async () => {
    await send("PUT", "/api/social/close-friends", author, { userIds: [] });
    expect((await get(`/api/social/stories/${cfStory}`, cf)).status).toBe(404);
    expect((await get(`/api/social/stories/user/${author}`, cf)).body.map((s: any) => s.id)).toEqual([pubStory]);
    await send("PUT", "/api/social/close-friends", author, { userIds: [cf] });
  });

  it("a tag does not open a Close Friends story for someone outside the list", async () => {
    const tagged = await send("POST", "/api/social/stories", author, {
      media: [{ ...photo(), overlays: [{ id: crypto.randomUUID(), type: "mention", x: 1, y: 1, scale: 1, rotation: 0, mentionUserId: follower, mentionHandle: `@${handle(follower)}` }] }],
      privacy: { closeFriendsOnly: true },
    });
    expect(tagged.status).toBe(201);
    expect((await get(`/api/social/stories/${tagged.body.id}`, follower)).status).toBe(404);
    const rail = await get("/api/social/stories/mentions", follower);
    expect(rail.body.items.find((i: any) => i.storyId === tagged.body.id)).toBeUndefined();
    const onProfile = await get(`/api/social/profile/${follower}/tagged`, outsider);
    expect(JSON.stringify(onProfile.body)).not.toContain(tagged.body.id);
  });
});

describe("highlights", () => {
  let liveStory = "";
  let cfOnly = "";
  let highlightId = "";

  it("creates a highlight and snapshots a live story's media", async () => {
    const s = await send("POST", "/api/social/stories", author, { media: [photo("https://img.test/h1.jpg")] });
    liveStory = s.body.id;
    const c = await send("POST", "/api/social/stories", author, { media: [photo("https://img.test/h-cf.jpg")], privacy: { closeFriendsOnly: true } });
    cfOnly = c.body.id;

    const created = await send("POST", "/api/social/highlights", author, { title: "  Summer   drop ", coverEmoji: "☀", coverColor: "#111111", storyIds: [liveStory] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ title: "Summer drop", itemCount: 1, coverEmoji: "☀", coverUrl: "https://img.test/h1.jpg" });
    highlightId = created.body.id;

    const dupe = await send("POST", `/api/social/highlights/${highlightId}/items`, author, { storyId: liveStory });
    expect(dupe.status).toBe(200);
    expect(dupe.body.itemCount).toBe(1);
    const add = await send("POST", `/api/social/highlights/${highlightId}/items`, author, { storyId: cfOnly });
    expect(add.status).toBe(201);
    expect(add.body.itemCount).toBe(2);
  });

  it("only my own stories can be added, and only by the owner", async () => {
    expect((await send("POST", `/api/social/highlights/${highlightId}/items`, author, { storyId: crypto.randomUUID() })).status).toBe(404);
    const theirs = await send("POST", "/api/social/stories", cf, { media: [photo()] });
    expect((await send("POST", `/api/social/highlights/${highlightId}/items`, author, { storyId: theirs.body.id })).status).toBe(404);
    expect((await send("POST", `/api/social/highlights/${highlightId}/items`, cf, { storyId: theirs.body.id })).status).toBe(404);
    expect((await send("PATCH", `/api/social/highlights/${highlightId}`, cf, { title: "hijack" })).status).toBe(404);
    expect((await send("DELETE", `/api/social/highlights/${highlightId}`, cf)).status).toBe(404);
    expect((await send("POST", `/api/social/highlights/${highlightId}/items`, author, {})).status).toBe(400);
  });

  it("survives expiry + cleanup, and the expired story lands in the author's archive", async () => {
    await db.update(stories).set({ expiresAt: new Date(Date.now() - 1000) }).where(inArray(stories.id, [liveStory, cfOnly]));
    const { runStoryCleanup } = await import("../../jobs/storyCleanup");
    await runStoryCleanup();
    expect(await db.select().from(stories).where(eq(stories.id, liveStory))).toHaveLength(0);

    const mine = await get("/api/social/highlights/me", author);
    expect(mine.body[0].items).toHaveLength(2);
    expect(mine.body[0].items[0].media[0].imageUri).toBe("https://img.test/h1.jpg");

    const picker = await get("/api/social/highlights/stories", author);
    expect(picker.body.find((s: any) => s.storyId === liveStory)).toMatchObject({ live: false, thumbnailUrl: "https://img.test/h1.jpg" });

    const second = await send("POST", "/api/social/highlights", author, { title: "Again", storyIds: [liveStory] });
    expect(second.body.itemCount).toBe(1);
    // Nobody else can read my archive.
    expect((await get("/api/social/highlights/stories", cf)).body.find((s: any) => s.storyId === liveStory)).toBeUndefined();
    expect((await send("POST", `/api/social/highlights/${second.body.id}/items`, cf, { storyId: liveStory })).status).toBe(404);
  });

  it("viewers only see items for their audience; blocked viewers see nothing", async () => {
    const titles = async (u: string) => (await get(`/api/social/highlights/user/${author}`, u)).body;
    const asCf = await titles(cf);
    expect(asCf.find((h: any) => h.id === highlightId).items).toHaveLength(2);
    const asFollower = await titles(follower);
    expect(asFollower.find((h: any) => h.id === highlightId).items).toHaveLength(1);
    // a stranger still sees the public profile highlight (public items only)
    expect((await titles(outsider)).find((h: any) => h.id === highlightId).items).toHaveLength(1);
    expect(await titles(blockedUser)).toEqual([]);

    const one = await get(`/api/social/highlights/${highlightId}`, follower);
    expect(one.status).toBe(200);
    expect(one.body.stories).toHaveLength(1);
    expect(one.body.stories[0].media[0].imageUri).toBe("https://img.test/h1.jpg");
    expect(one.body.stories[0].expiresAt).toBeGreaterThan(Date.now());
    expect((await get(`/api/social/highlights/${highlightId}`, blockedUser)).status).toBe(404);
    expect((await get(`/api/social/highlights/${highlightId}`, cf)).body.stories).toHaveLength(2);
  });

  it("a highlight whose items are all outside the viewer's audience is hidden", async () => {
    const only = await send("POST", "/api/social/highlights", author, { title: "Inner circle", storyIds: [cfOnly] });
    const list = (u: string) => get(`/api/social/highlights/user/${author}`, u).then((r) => r.body.map((h: any) => h.id));
    expect(await list(follower)).not.toContain(only.body.id);
    expect(await list(cf)).toContain(only.body.id);
    expect((await get(`/api/social/highlights/${only.body.id}`, follower)).status).toBe(404);
  });

  it("deleting a live story early removes it from highlights; edit and delete work", async () => {
    const s = await send("POST", "/api/social/stories", author, { media: [photo("https://img.test/h3.jpg")] });
    const added = await send("POST", `/api/social/highlights/${highlightId}/items`, author, { storyId: s.body.id });
    expect(added.body.itemCount).toBe(3);
    await send("DELETE", `/api/social/stories/${s.body.id}`, author);
    expect((await get("/api/social/highlights/me", author)).body.find((h: any) => h.id === highlightId).itemCount).toBe(2);

    const patched = await send("PATCH", `/api/social/highlights/${highlightId}`, author, { title: "Renamed", coverUrl: "https://img.test/c.jpg" });
    expect(patched.body).toMatchObject({ title: "Renamed", coverUrl: "https://img.test/c.jpg" });
    const item = patched.body.items[0].id;
    expect((await send("DELETE", `/api/social/highlights/${highlightId}/items/${item}`, cf)).status).toBe(404);
    expect((await send("DELETE", `/api/social/highlights/${highlightId}/items/${item}`, author)).status).toBe(200);
    expect((await send("DELETE", `/api/social/highlights/${highlightId}`, author)).status).toBe(200);
    expect((await get(`/api/social/highlights/${highlightId}`, author)).status).toBe(404);
  });
});

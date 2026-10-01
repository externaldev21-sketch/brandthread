/**
 * Communities (topic group chats), real DB + real Express router + the real
 * WebSocket hub. Covers the launch flow end to end:
 *
 *   join → inbox row → send/receive over the realtime channel → mute stops
 *   push → leave, plus image moderation (reject / unavailable / allowed),
 *   text policy, reports, blocks, admin tools, private invites, creation
 *   rate limit, and a 1,500-member fan-out check for the unread design.
 *
 * `requireAuth` reads the caller off a header (same substitution the other
 * integration tests here use); image moderation + object storage are injected
 * through their test seams; push is recorded instead of hitting Expo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import sharp from "sharp";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db, users, communities, communityMembers, communityMessages, communityBans, reports } from "@workspace/db";

const pushes: { userId: string; title: string; body: string }[] = [];

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));
vi.mock("../../lib/push", async (orig) => ({
  ...(await orig<typeof import("../../lib/push")>()),
  sendPushToUser: async (userId: string, payload: { title: string; body: string }) => {
    pushes.push({ userId, title: payload.title, body: payload.body });
    return true;
  },
}));

import communitiesRouter, { MAX_OWNED_GROUPS } from "../communities";
import reportsRouter from "../reports";
import { attachCommunityWebSocket } from "../../ws/communityHub";
import { setImageModerationProvider } from "../../lib/imageModeration";
import { setCommunityImageStore } from "../../lib/communityMedia";
import { flushDueCommunityPushes } from "../../lib/communityPush";
import { RATE_LIMIT_POLICIES } from "../../middlewares/rateLimit";

const P = `cm${process.pid}`;
const U = (n: string) => `${P}-${n}`;
const ALICE = U("alice"), BOB = U("bob"), CARA = U("cara"), DAN = U("dan"), ADMIN = U("platform-admin");
const BUCKET = "test-bucket";

let server: Server;
let base = "";
const uploaded: string[] = [];

function as(user: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}), "x-test-acting-as": user },
  });
}
const post = (u: string, p: string, body?: unknown) => as(u, p, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = (u: string, p: string, body?: unknown) => as(u, p, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const put = (u: string, p: string, body?: unknown) => as(u, p, { method: "PUT", body: JSON.stringify(body ?? {}) });
const del = (u: string, p: string) => as(u, p, { method: "DELETE" });

async function png(color: { r: number; g: number; b: number }) {
  return (await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer()).toString("base64");
}
const SAFE = { r: 40, g: 120, b: 200 };
const GORE = { r: 255, g: 0, b: 0 };

async function official(slug: string) {
  const [c] = await db.select().from(communities).where(eq(communities.slug, slug));
  return c;
}

async function cleanup() {
  const mine = await db.select({ id: communities.id }).from(communities).where(like(communities.ownerId, `${P}-%`));
  const ids = mine.map((c) => c.id);
  if (ids.length) await db.delete(communities).where(inArray(communities.id, ids));
  await db.delete(communityMembers).where(like(communityMembers.userId, `${P}-%`));
  await db.delete(reports).where(like(reports.reporterId, `${P}-%`));
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
  await db.execute(sql`DELETE FROM communities WHERE slug LIKE ${`${P}-%`}`);
  await db.execute(sql`DELETE FROM community_messages WHERE sender_id LIKE ${`${P}-%`}`);
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ${`%:user:${P}-%`}`);
  // Official communities persist between tests: put their counters back.
  await db.execute(sql`
    UPDATE communities c SET
      member_count = (SELECT count(*) FROM community_members m WHERE m.community_id = c.id),
      last_seq = COALESCE((SELECT max(seq) FROM community_messages x WHERE x.community_id = c.id), 0),
      last_message_preview = NULL, last_message_sender_name = NULL, last_message_at = NULL,
      push_pending_count = 0, last_push_at = NULL
    WHERE c.kind = 'official'`);
}

function listen(sock: WebSocket) {
  const events: any[] = [];
  sock.on("message", (d) => events.push(JSON.parse(d.toString())));
  return events;
}
function openSocket(user: string, communityId: string): Promise<{ ws: WebSocket; events: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/ws/community?communityId=${communityId}&token=${user}`);
    const events = listen(ws);
    ws.once("open", () => resolve({ ws, events }));
    ws.once("unexpected-response", (_r, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}
const until = async (fn: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
};

beforeAll(async () => {
  process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = BUCKET;
  setCommunityImageStore(async ({ userId }) => {
    const url = `https://storage.googleapis.com/${BUCKET}/community/${userId}/${randomUUID()}.jpg`;
    uploaded.push(url);
    return url;
  });
  // Stand-in classifier: pure red = graphic content.
  setImageModerationProvider(async ({ buffer }) => {
    const stats = await sharp(buffer).stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    return r > 200 && g < 60 && b < 60 ? { status: "rejected", categories: ["violence/graphic"] } : { status: "allowed" };
  });

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/communities", communitiesRouter);
  app.use("/api/reports", reportsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  attachCommunityWebSocket(server, { verifyToken: async (t) => t ?? null });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await cleanup();
  setImageModerationProvider();
  setCommunityImageStore();
  await new Promise<void>((r) => server?.close(() => r()));
});

beforeEach(async () => {
  pushes.length = 0;
  uploaded.length = 0;
  await cleanup();
  await db.insert(users).values([ALICE, BOB, CARA, DAN, ADMIN].map((id) => ({
    clerkId: id, email: `${id}@example.test`, name: id.split("-")[1], displayName: id.split("-")[1][0].toUpperCase() + id.split("-")[1].slice(1),
    accountType: id === ALICE ? "seller" : "buyer", onboardingComplete: true, role: id === ADMIN ? "admin" : "owner",
  })));
});

describe("official communities", () => {
  it("are seeded with the six launch groups, verified, and listed first", async () => {
    const res = await as(BOB, "/communities");
    const body = await res.json() as { communities: any[] };
    const names = body.communities.filter((c) => c.kind === "official").map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      "Graphic Design Community", "Photography & Content", "Ads & Marketing",
      "Creative Direction", "Streetwear Founders", "Sourcing & Manufacturing",
    ]));
    expect(body.communities.slice(0, 6).every((c) => c.verified)).toBe(true);
    // Migration 112 tightened the copy so every description fits a card on one line.
    for (const c of body.communities.filter((x) => x.kind === "official")) expect(c.description.length).toBeLessThanOrEqual(48);
    expect(body.communities.find((c) => c.name === "Graphic Design Community")).toMatchObject({ joined: false, memberCount: expect.any(Number) });
  });

  it("are readable signed out (no auth header), without viewer state", async () => {
    const res = await fetch(`${base}/api/communities/public`);
    expect(res.status).toBe(200);
    const body = await res.json() as { communities: any[] };
    expect(body.communities.length).toBeGreaterThanOrEqual(6);
    expect(body.communities.every((c) => c.joined === false)).toBe(true);
    // ...but joining still needs a session.
    const g = await official("graphic-design");
    expect((await fetch(`${base}/api/communities/${g.id}/join`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/api/communities/mine`)).status).toBe(401);
  });
});

describe("join → inbox row → realtime → mute → leave", () => {
  it("walks the whole launch flow", async () => {
    const g = await official("graphic-design");
    const before = g.memberCount;

    // Join (buyer + seller) — consent is joining itself, no request step.
    expect((await post(BOB, `/communities/${g.id}/join`)).status).toBe(200);
    expect((await post(ALICE, `/communities/${g.id}/join`)).status).toBe(200);
    expect((await post(BOB, `/communities/${g.id}/join`)).status).toBe(200); // idempotent
    expect((await official("graphic-design")).memberCount).toBe(before + 2);

    // Inbox row: icon key + name + (no messages yet) + unread 0.
    let mine = await (await as(BOB, "/communities/mine")).json() as any[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: g.id, name: "Graphic Design Community", iconKey: "pen-tool", unreadCount: 0, muted: false, joined: true, verified: true });

    // Bob opens the live channel; Alice sends; Bob receives it in realtime.
    const { ws, events } = await openSocket(BOB, g.id);
    const sent = await post(ALICE, `/communities/${g.id}/messages`, { text: "anyone tried Figma variables for tees? 🔥" });
    expect(sent.status).toBe(201);
    await until(() => events.some((e) => e.type === "message.created"));
    const live = events.find((e) => e.type === "message.created").message;
    expect(live).toMatchObject({ text: "anyone tried Figma variables for tees? 🔥", fromId: ALICE, fromAccountType: "seller", seq: 1 });

    // Bob had the chat open (live), so no push; Bob's row shows last message + unread.
    mine = await (await as(BOB, "/communities/mine")).json() as any[];
    expect(mine[0]).toMatchObject({ lastMessage: "anyone tried Figma variables for tees? 🔥", lastMessageSenderName: "Alice", unreadCount: 1 });
    await until(() => true);
    expect(pushes.filter((p) => p.userId === BOB)).toHaveLength(0);
    ws.close();

    // Reading moves the cursor and clears unread.
    expect((await patch(BOB, `/communities/${g.id}/read`)).status).toBe(200);
    mine = await (await as(BOB, "/communities/mine")).json() as any[];
    expect(mine[0].unreadCount).toBe(0);

    // Mute → no pushes for Bob, but the row still tracks unread (quietly).
    expect((await patch(BOB, `/communities/${g.id}/mute`, { muted: true })).status).toBe(200);
    await db.execute(sql`UPDATE communities SET last_push_at = now() - interval '10 minutes' WHERE id = ${g.id}::uuid`);
    await post(ALICE, `/communities/${g.id}/messages`, { text: "second one while you're muted" });
    await until(() => pushes.length > 0 || true, 200);
    await new Promise((r) => setTimeout(r, 150));
    expect(pushes.filter((p) => p.userId === BOB)).toHaveLength(0);
    mine = await (await as(BOB, "/communities/mine")).json() as any[];
    expect(mine[0]).toMatchObject({ muted: true, unreadCount: 1 });

    // Unmute → next batch pushes Bob again.
    await patch(BOB, `/communities/${g.id}/mute`, { muted: false });
    await db.execute(sql`UPDATE communities SET last_push_at = now() - interval '10 minutes' WHERE id = ${g.id}::uuid`);
    await post(ALICE, `/communities/${g.id}/messages`, { text: "third, you're back" });
    await until(() => pushes.some((p) => p.userId === BOB));
    expect(pushes.find((p) => p.userId === BOB)).toMatchObject({ title: "Graphic Design Community", body: "Alice: third, you're back" });

    // Leave: row disappears, history is closed to them, socket for a leaver is kicked.
    const s2 = await openSocket(BOB, g.id);
    const closed = new Promise<number>((r) => s2.ws.once("close", (code) => r(code)));
    expect((await post(BOB, `/communities/${g.id}/leave`)).status).toBe(200);
    expect(await closed).toBe(4403);
    mine = await (await as(BOB, "/communities/mine")).json() as any[];
    expect(mine).toHaveLength(0);
    expect((await as(BOB, `/communities/${g.id}/messages`)).status).toBe(403);
    expect((await official("graphic-design")).memberCount).toBe(before + 1);
    await expect(openSocket(BOB, g.id)).rejects.toThrow("403");
  });

  it("batches a burst into one push: 'N new messages in <name>'", async () => {
    const g = await official("ads-marketing");
    await post(BOB, `/communities/${g.id}/join`);
    await post(ALICE, `/communities/${g.id}/join`);
    await post(ALICE, `/communities/${g.id}/messages`, { text: "first!" });
    await until(() => pushes.some((p) => p.userId === BOB)); // quiet chat → immediate push
    expect(pushes.find((p) => p.userId === BOB)!.body).toBe("Alice: first!");
    pushes.length = 0;

    for (let i = 0; i < 12; i++) await post(ALICE, `/communities/${g.id}/messages`, { text: `msg ${i}` });
    await new Promise((r) => setTimeout(r, 150));
    expect(pushes).toHaveLength(0); // throttled inside the window

    await db.execute(sql`UPDATE communities SET last_push_at = now() - interval '4 minutes' WHERE id = ${g.id}::uuid`);
    await flushDueCommunityPushes();
    expect(pushes.filter((p) => p.userId === BOB)).toEqual([
      expect.objectContaining({ userId: BOB, body: "12 new messages in Ads & Marketing" }),
    ]);
    // Flushing again sends nothing (batch already claimed).
    pushes.length = 0;
    await flushDueCommunityPushes();
    expect(pushes).toHaveLength(0);
  });
});

describe("history, replies, reactions", () => {
  it("paginates by seq cursor, supports replies and reactions, and catch-up via after=", async () => {
    const g = await official("creative-direction");
    await post(ALICE, `/communities/${g.id}/join`);
    await post(BOB, `/communities/${g.id}/join`);
    for (let i = 1; i <= 7; i++) await post(ALICE, `/communities/${g.id}/messages`, { text: `m${i}` });

    const page1 = await (await as(BOB, `/communities/${g.id}/messages?limit=3`)).json() as any;
    expect(page1.messages.map((m: any) => m.text)).toEqual(["m5", "m6", "m7"]);
    expect(page1.hasMore).toBe(true);
    const page2 = await (await as(BOB, `/communities/${g.id}/messages?limit=3&before=${page1.nextBefore}`)).json() as any;
    expect(page2.messages.map((m: any) => m.text)).toEqual(["m2", "m3", "m4"]);
    const catchUp = await (await as(BOB, `/communities/${g.id}/messages?after=5`)).json() as any;
    expect(catchUp.messages.map((m: any) => m.text)).toEqual(["m6", "m7"]);

    const target = page1.messages[2];
    const reply = await (await post(BOB, `/communities/${g.id}/messages`, { text: "agreed", replyToId: target.id })).json() as any;
    expect(reply).toMatchObject({ replyToId: target.id, replyPreview: "m7", replyToAuthorName: "Alice" });

    const r = await (await put(BOB, `/communities/${g.id}/messages/${target.id}/reactions`, { reactionType: "fire" })).json() as any;
    expect(r.reactions).toEqual([expect.objectContaining({ userId: BOB, reactionType: "fire" })]);
    expect((await put(BOB, `/communities/${g.id}/messages/${target.id}/reactions`, { reactionType: "nope" })).status).toBe(400);
    const after = await (await del(BOB, `/communities/${g.id}/messages/${target.id}/reactions`)).json() as any;
    expect(after.reactions).toEqual([]);
  });
});

describe("image moderation", () => {
  it("rejects gore with a calm message, stores nothing, and delivers nothing", async () => {
    const g = await official("photography-content");
    await post(BOB, `/communities/${g.id}/join`);
    const res = await post(BOB, "/communities/upload-photo", { data: await png(GORE), mimeType: "image/png" });
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body).toMatchObject({ code: "IMAGE_REJECTED", error: "This photo can't be shared in Brandthread communities. Try a different one." });
    expect(uploaded).toHaveLength(0);
    const hist = await (await as(BOB, `/communities/${g.id}/messages`)).json() as any;
    expect(hist.messages).toHaveLength(0);
  });

  it("accepts a clean photo, re-encodes it, and only moderated URLs can be attached to messages", async () => {
    const g = await official("photography-content");
    await post(BOB, `/communities/${g.id}/join`);
    await post(ALICE, `/communities/${g.id}/join`);
    const up = await post(BOB, "/communities/upload-photo", { data: `data:image/png;base64,${await png(SAFE)}`, mimeType: "image/png" });
    expect(up.status).toBe(200);
    const { url } = await up.json() as { url: string };
    expect(url).toContain(`/community/${BOB}/`);

    const ok = await post(BOB, `/communities/${g.id}/messages`, { attachments: [{ type: "image", url, width: 64, height: 64 }] });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ text: "", attachments: [expect.objectContaining({ type: "image", url })] });
    const row = await (await as(ALICE, "/communities/mine")).json() as any[];
    expect(row[0].lastMessage).toBe("Photo");

    // A pasted URL — never went through moderation — is refused.
    const pasted = await post(BOB, `/communities/${g.id}/messages`, { attachments: [{ type: "image", url: "https://evil.example/gore.jpg" }] });
    expect(pasted.status).toBe(400);
    expect(await pasted.json()).toMatchObject({ code: "INVALID_ATTACHMENT" });
    // Not an image at all.
    const junk = await post(BOB, "/communities/upload-photo", { data: Buffer.from("hello world").toString("base64"), mimeType: "image/png" });
    expect(junk.status).toBe(400);
  });

  it("fails closed when the checker is unavailable", async () => {
    setImageModerationProvider(async () => ({ status: "unavailable" }));
    try {
      const res = await post(BOB, "/communities/upload-photo", { data: await png(SAFE), mimeType: "image/png" });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: "IMAGE_CHECK_UNAVAILABLE" });
      expect(uploaded).toHaveLength(0);
    } finally {
      setImageModerationProvider(async ({ buffer }) => {
        const [r, g, b] = (await sharp(buffer).stats()).channels.map((c) => c.mean);
        return r > 200 && g < 60 && b < 60 ? { status: "rejected", categories: ["violence/graphic"] } : { status: "allowed" };
      });
    }
  });
});

describe("text policy, reports, blocks", () => {
  it("does not filter ordinary words (profanity passes) but still blocks threats and doxxing", async () => {
    const g = await official("streetwear-founders");
    await post(BOB, `/communities/${g.id}/join`);
    expect((await post(BOB, `/communities/${g.id}/messages`, { text: "this colorway is fucking fire, bullshit pricing tho" })).status).toBe(201);
    const threat = await post(BOB, `/communities/${g.id}/messages`, { text: "I will kill you" });
    expect(threat.status).toBe(422);
    expect(await threat.json()).toMatchObject({ code: "MODERATED" });
    expect((await post(BOB, `/communities/${g.id}/messages`, { text: "i know where you live" })).status).toBe(422);
  });

  it("reports a message through the moderation queue (members only) and hides a blocked user's messages", async () => {
    const g = await official("streetwear-founders");
    for (const u of [ALICE, BOB, CARA]) await post(u, `/communities/${g.id}/join`);
    const m = await (await post(CARA, `/communities/${g.id}/messages`, { text: "buy my crypto" })).json() as any;
    await post(ALICE, `/communities/${g.id}/messages`, { text: "hello room" });

    const rep = await post(BOB, "/reports", { targetType: "community_message", targetId: m.id, reason: "spam" });
    expect(rep.status).toBe(201);
    expect(await rep.json()).toMatchObject({ targetType: "community_message" });
    const [row] = await db.select().from(reports).where(eq(reports.targetId, m.id));
    expect(row).toMatchObject({ targetOwnerId: CARA, reporterId: BOB, status: "pending", contentExcerpt: "buy my crypto" });
    expect((await post(DAN, "/reports", { targetType: "community_message", targetId: m.id, reason: "spam" })).status).toBe(403); // non-member
    expect((await post(CARA, "/reports", { targetType: "community_message", targetId: m.id, reason: "spam" })).status).toBe(400); // own

    // Block (existing route's table) hides CARA for BOB only.
    const { blocks } = await import("@workspace/db");
    await db.insert(blocks).values({ blockerId: BOB, blockedId: CARA });
    try {
      const forBob = await (await as(BOB, `/communities/${g.id}/messages`)).json() as any;
      expect(forBob.messages.map((x: any) => x.text)).toEqual(["hello room"]);
      const forAlice = await (await as(ALICE, `/communities/${g.id}/messages`)).json() as any;
      expect(forAlice.messages.map((x: any) => x.text)).toEqual(["buy my crypto", "hello room"]);
    } finally {
      await db.delete(blocks).where(eq(blocks.blockerId, BOB));
    }
  });
});

describe("user-created groups", () => {
  async function create(user: string, body: Record<string, unknown>) {
    const res = await post(user, "/communities", body);
    return { res, json: await res.json() as any };
  }

  it("creates a public group: owner role, no verified mark, listed in search, anyone can join", async () => {
    const { res, json } = await create(BOB, { name: `${P} Denim Heads`, description: "Raw denim talk", visibility: "public" });
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ kind: "user", verified: false, role: "owner", memberCount: 1, visibility: "public", joined: true });
    const found = await (await as(CARA, `/communities?q=${encodeURIComponent(P + " Denim")}`)).json() as any;
    expect(found.communities.map((c: any) => c.id)).toContain(json.id);
    expect((await post(CARA, `/communities/${json.id}/join`)).status).toBe(200);
    const guest = await (await fetch(`${base}/api/communities/public?q=${encodeURIComponent(P + " Denim")}`)).json() as any;
    expect(guest.communities).toHaveLength(1);
  });

  it("private groups are unlisted and join only by invite code; approval mode queues a request", async () => {
    const { json: g } = await create(ALICE, { name: `${P} Inner Circle`, visibility: "private" });
    const search = await (await as(BOB, `/communities?q=${encodeURIComponent(P + " Inner")}`)).json() as any;
    expect(search.communities).toHaveLength(0);
    expect((await post(BOB, `/communities/${g.id}/join`)).status).toBe(403);
    expect((await as(BOB, `/communities/${g.id}`)).status).toBe(404);
    expect((await as(BOB, `/communities/${g.id}/invite`)).status).toBe(403);

    const { code, url } = await (await as(ALICE, `/communities/${g.id}/invite`)).json() as any;
    expect(url).toContain(code);
    const preview = await (await fetch(`${base}/api/communities/invite/${code}`)).json() as any;
    expect(preview).toMatchObject({ name: `${P} Inner Circle`, visibility: "private", verified: false });
    expect(preview.memberCount).toBe(1);

    expect((await post(BOB, "/communities/join-by-code", { code })).status).toBe(200);
    expect((await as(BOB, `/communities/${g.id}`)).status).toBe(200);
    expect((await post(BOB, "/communities/join-by-code", { code: "nope123456" })).status).toBe(404);

    // Approval mode
    await patch(ALICE, `/communities/${g.id}`, { requireApproval: true });
    expect((await post(CARA, "/communities/join-by-code", { code })).status).toBe(202);
    expect((await as(CARA, `/communities/${g.id}/messages`)).status).toBe(403);
    expect((await as(BOB, `/communities/${g.id}/requests`)).status).toBe(403);
    const pending = await (await as(ALICE, `/communities/${g.id}/requests`)).json() as any[];
    expect(pending.map((r) => r.userId)).toEqual([CARA]);
    expect((await post(ALICE, `/communities/${g.id}/requests/${CARA}/approve`)).status).toBe(200);
    expect((await as(CARA, `/communities/${g.id}/messages`)).status).toBe(200);

    // Reset invalidates the old link.
    const fresh = await (await post(ALICE, `/communities/${g.id}/invite/reset`)).json() as any;
    expect(fresh.code).not.toBe(code);
    expect((await fetch(`${base}/api/communities/invite/${code}`)).status).toBe(404);
  });

  it("owner tools: edit, promote, remove, ban (no rejoin), delete messages, transfer, delete group", async () => {
    const { json: g } = await create(ALICE, { name: `${P} Owners Room`, visibility: "public" });
    for (const u of [BOB, CARA, DAN]) await post(u, `/communities/${g.id}/join`);

    expect((await patch(BOB, `/communities/${g.id}`, { name: "hijack" })).status).toBe(403);
    const edited = await (await patch(ALICE, `/communities/${g.id}`, { description: "New blurb" })).json() as any;
    expect(edited.description).toBe("New blurb");

    // promote Bob to admin; admin can remove members but not the owner
    expect((await patch(ALICE, `/communities/${g.id}/members/${BOB}/role`, { role: "admin" })).status).toBe(200);
    expect((await patch(BOB, `/communities/${g.id}/members/${CARA}/role`, { role: "admin" })).status).toBe(403);
    expect((await del(BOB, `/communities/${g.id}/members/${ALICE}`)).status).toBe(403);

    const m = await (await post(CARA, `/communities/${g.id}/messages`, { text: "spammy thing" })).json() as any;
    expect((await del(DAN, `/communities/${g.id}/messages/${m.id}`)).status).toBe(403);
    expect((await del(BOB, `/communities/${g.id}/messages/${m.id}`)).status).toBe(200); // admin removes
    const hist = await (await as(DAN, `/communities/${g.id}/messages`)).json() as any;
    expect(hist.messages).toHaveLength(0);
    const rowAfter = await (await as(CARA, "/communities/mine")).json() as any[];
    expect(rowAfter.find((r) => r.id === g.id).lastMessage).toBeUndefined();

    // remove vs ban
    expect((await del(BOB, `/communities/${g.id}/members/${DAN}`)).status).toBe(200);
    expect((await post(DAN, `/communities/${g.id}/join`)).status).toBe(200); // removal ≠ ban
    expect((await post(BOB, `/communities/${g.id}/members/${CARA}/ban`)).status).toBe(200);
    expect((await post(CARA, `/communities/${g.id}/join`)).status).toBe(403);
    const [ban] = await db.select().from(communityBans).where(eq(communityBans.userId, CARA));
    expect(ban.bannedBy).toBe(BOB);
    expect((await as(ALICE, `/communities/${g.id}/bans`)).status).toBe(200);
    expect((await del(ALICE, `/communities/${g.id}/bans/${CARA}`)).status).toBe(200);
    expect((await post(CARA, `/communities/${g.id}/join`)).status).toBe(200);

    // owner can't leave, but can transfer then leave
    expect((await post(ALICE, `/communities/${g.id}/leave`)).status).toBe(409);
    expect((await patch(ALICE, `/communities/${g.id}/members/${BOB}/role`, { role: "owner" })).status).toBe(200);
    expect((await post(ALICE, `/communities/${g.id}/leave`)).status).toBe(200);
    expect((await del(ALICE, `/communities/${g.id}`)).status).toBe(403);
    expect((await del(BOB, `/communities/${g.id}`)).status).toBe(200);
    expect((await as(DAN, `/communities/${g.id}`)).status).toBe(404);
    expect(await (await as(DAN, "/communities/mine")).json()).toEqual([]);
  });

  it("official communities can't be edited or deleted by group members, and aren't reportable as groups", async () => {
    const g = await official("graphic-design");
    await post(ALICE, `/communities/${g.id}/join`);
    expect((await patch(ALICE, `/communities/${g.id}`, { name: "x".repeat(10) })).status).toBe(403);
    expect((await del(ALICE, `/communities/${g.id}`)).status).toBe(403);
    // Platform moderators can edit an official community.
    expect((await patch(ADMIN, `/communities/${g.id}`, { description: g.description })).status).toBe(200);
  });

  it("reserves official names, screens the name text, reports groups, and validates photos", async () => {
    expect((await create(BOB, { name: "Brandthread Official" })).res.status).toBe(422);
    expect((await create(BOB, { name: "graphic design community" })).res.status).toBe(422);
    expect((await create(BOB, { name: "ab" })).res.status).toBe(400);
    expect((await create(BOB, { name: `${P} fine name`, iconUrl: "https://evil.example/x.jpg" })).res.status).toBe(400);
    const threat = await create(BOB, { name: `${P} group`, description: "i know where you live" });
    expect(threat.res.status).toBe(422);

    // (every attempt above counted against the creation limit)
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ${`community-create:user:${BOB}`}`);
    const { json: g } = await create(BOB, { name: `${P} Reportable` });
    const rep = await post(CARA, "/reports", { targetType: "community", targetId: g.id, reason: "harassment" });
    expect(rep.status, JSON.stringify(await rep.clone().json())).toBe(201);
    const [c] = await db.select().from(communities).where(eq(communities.id, g.id));
    expect(c.reportCount).toBe(1);
    expect((await post(BOB, "/reports", { targetType: "community", targetId: g.id, reason: "spam" })).status).toBe(400); // own group
  });

  it("rate-limits group creation per account (5/day) and caps owned groups", async () => {
    expect(RATE_LIMIT_POLICIES["community-create"]).toMatchObject({ limit: 5, windowMs: 24 * 60 * 60_000 });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(DAN, "/communities", { name: `${P} Spam ${i}` })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    // other accounts are unaffected
    expect((await post(CARA, "/communities", { name: `${P} Calm Group` })).status).toBe(201);

    // Hard cap on owned groups, independent of the window.
    await db.insert(communities).values(Array.from({ length: MAX_OWNED_GROUPS - 5 }, (_, i) => ({
      name: `${P} bulk ${i}`, slug: `${P}-bulk-${i}`, ownerId: DAN, kind: "user", visibility: "public", inviteCode: `bulk${P.slice(2)}${i}`.toLowerCase().slice(0, 14),
    })));
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ${`community-create:user:${DAN}`}`);
    const capped = await post(DAN, "/communities", { name: `${P} One Too Many` });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ code: "GROUP_LIMIT" });
  });
});

describe("unlimited members: 1,500-member load test for the unread / fan-out design", () => {
  it("a message is one row + one counter bump; unread, push and history stay O(1) per send", async () => {
    const N = 1500;
    const [g] = await db.insert(communities).values({
      name: `${P} Big Room`, slug: `${P}-big-room`, ownerId: ALICE, kind: "user", visibility: "public", inviteCode: `big${process.pid}`.slice(0, 12),
    }).returning();
    // 1,500 real members in one statement: ALICE + 1,499 others (100 of them muted).
    await db.execute(sql`
      INSERT INTO community_members (community_id, user_id, role, muted, last_read_seq)
      SELECT ${g.id}::uuid, CASE WHEN i = 0 THEN ${ALICE} ELSE ${P + "-m-"} || i END,
             CASE WHEN i = 0 THEN 'owner' ELSE 'member' END, (i BETWEEN 1 AND 100), 0
      FROM generate_series(0, ${N - 1}) AS i
    `);
    await db.update(communities).set({ memberCount: N }).where(eq(communities.id, g.id));

    const writesBefore = await db.execute(sql`SELECT n_tup_upd, n_tup_ins FROM pg_stat_user_tables WHERE relname = 'community_members'`);
    const t0 = Date.now();
    const res = await post(ALICE, `/communities/${g.id}/messages`, { text: "hello 1,500 people" });
    const sendMs = Date.now() - t0;
    expect(res.status).toBe(201);
    expect(sendMs).toBeLessThan(1500);

    // Exactly one message row, no per-member rows of any kind.
    const [{ msgs }] = (await db.execute(sql`SELECT count(*)::int AS msgs FROM community_messages WHERE community_id = ${g.id}::uuid`)).rows as any[];
    expect(msgs).toBe(1);
    // Member rows untouched except the sender's own cursor (single row update).
    const [{ touched }] = (await db.execute(sql`SELECT count(*)::int AS touched FROM community_members WHERE community_id = ${g.id}::uuid AND last_read_seq <> 0`)).rows as any[];
    expect(touched).toBe(1);
    void writesBefore;

    // Unread for everyone else is derived: head seq - cursor = 1, with zero stored unread rows.
    const [{ unread }] = (await db.execute(sql`
      SELECT count(*)::int AS unread FROM community_members m JOIN communities c ON c.id = m.community_id
      WHERE m.community_id = ${g.id}::uuid AND c.last_seq - m.last_read_seq = 1
    `)).rows as any[];
    expect(unread).toBe(N - 1);

    // A member's inbox row is a single indexed lookup and reports unread 1.
    const row = (await (await as(U("m-7"), "/communities/mine")).json() as any[])[0];
    expect(row).toMatchObject({ id: g.id, unreadCount: 1, muted: true, memberCount: N });

    // Push: first message → immediate batch to the UNMUTED, unread members only.
    await until(() => pushes.length >= N - 1 - 100, 15000);
    expect(pushes).toHaveLength(N - 1 - 100);
    expect(pushes.some((p) => p.userId === ALICE)).toBe(false);          // sender
    expect(pushes.some((p) => p.userId === U("m-50"))).toBe(false);      // muted
    expect(pushes.some((p) => p.userId === U("m-500"))).toBe(true);

    // A burst inside the window costs zero pushes, then one batched push wave.
    pushes.length = 0;
    for (let i = 0; i < 20; i++) await post(ALICE, `/communities/${g.id}/messages`, { text: `burst ${i}` });
    await new Promise((r) => setTimeout(r, 200));
    expect(pushes).toHaveLength(0);
    await db.execute(sql`UPDATE communities SET last_push_at = now() - interval '5 minutes' WHERE id = ${g.id}::uuid`);
    await flushDueCommunityPushes();
    expect(pushes).toHaveLength(N - 1 - 100);
    expect(new Set(pushes.map((p) => p.body))).toEqual(new Set([`20 new messages in ${P} Big Room`]));

    // History pagination and the member list stay paged regardless of size.
    const h = await (await as(U("m-7"), `/communities/${g.id}/messages?limit=50`)).json() as any;
    expect(h.messages).toHaveLength(21 > 50 ? 50 : 21);
    const members = await (await as(U("m-7"), `/communities/${g.id}/members?limit=50`)).json() as any;
    expect(members.members).toHaveLength(50);
    expect(members.nextOffset).toBe(50);
    expect(members.memberCount).toBe(N);
    expect(members.members[0].role).toBe("owner");

    // Leaving decrements the counter and never scans other members.
    await post(U("m-7"), `/communities/${g.id}/leave`);
    const [after] = await db.select().from(communities).where(eq(communities.id, g.id));
    expect(after.memberCount).toBe(N - 1);
    await db.delete(communityMessages).where(eq(communityMessages.communityId, g.id));
  }, 60_000);
});

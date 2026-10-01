import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, users, blocks, userContactHashes } from "@workspace/db";
import { inArray, or } from "drizzle-orm";
import { hashContact } from "../../lib/contactHashes";

const tag = crypto.randomBytes(5).toString("hex");
const me = `contacts-me-${tag}`;
const friend = `contacts-friend-${tag}`;
const blockedFriend = `contacts-blocked-${tag}`;
const hidden = `contacts-hidden-${tag}`; // never opted in
const ids = [me, friend, blockedFriend, hidden];
const emailOf = (id: string) => `${id}@example.test`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    if (!req.clerkUserId) return res.status(401).json({ error: "unauthorized" });
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: any) => next() }));

let server: Server;
let base = "";
const call = (path: string, method: string, body?: unknown, user: string | null = me) =>
  fetch(`${base}/api/social/contacts${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  process.env.CONTACT_SYNC_ENABLED = "true";
  await db.insert(users).values(ids.map((id) => ({
    clerkId: id, email: emailOf(id), name: id, accountType: "buyer" as const,
  }))).onConflictDoNothing();
  await db.insert(blocks).values({ blockerId: me, blockedId: blockedFriend }).onConflictDoNothing();
  const { default: router } = await import("../social-contacts");
  const app = express();
  app.use(express.json());
  app.use("/api/social/contacts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(userContactHashes).where(inArray(userContactHashes.userId, ids));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("/api/social/contacts", () => {
  it("requires auth", async () => {
    expect((await call("/status", "GET", undefined, null)).status).toBe(401);
  });

  it("is off (503) when CONTACT_SYNC_ENABLED is not set, but status and revoke still answer", async () => {
    process.env.CONTACT_SYNC_ENABLED = "";
    expect(await (await call("/status", "GET")).json()).toEqual({ enabled: false, optedIn: false });
    expect((await call("/match", "POST", { hashes: [] })).status).toBe(503);
    expect((await call("", "DELETE")).status).toBe(200);
    process.env.CONTACT_SYNC_ENABLED = "true";
  });

  it("validates the hash list (shape and 2000 max)", async () => {
    expect((await call("/match", "POST", { hashes: ["ana@example.com"] })).status).toBe(400);
    expect((await call("/match", "POST", {})).status).toBe(400);
    const tooMany = Array.from({ length: 2001 }, (_, i) => hashContact("phone", `+1415555${i}`));
    expect((await call("/match", "POST", { hashes: tooMany })).status).toBe(413);
  });

  it("only matches users who opted in, excludes blocked users and self, and revoke removes them", async () => {
    expect((await call("/opt-in", "POST", {}, friend)).status).toBe(200);
    expect((await call("/opt-in", "POST", {}, blockedFriend)).status).toBe(200);
    expect((await call("/opt-in", "POST", {}, me)).status).toBe(200);

    const hashes = ids.map((id) => hashContact("email", emailOf(id)));
    const res = await call("/match", "POST", { hashes });
    const body = (await res.json()) as { matches: Array<{ userId: string; isFollowing: boolean }> };
    expect(body.matches.map((m) => m.userId)).toEqual([friend]); // not me, not blocked, not the un-opted-in user
    expect(body.matches[0].isFollowing).toBe(false);

    expect((await call("", "DELETE", undefined, friend)).status).toBe(200);
    const after = (await (await call("/match", "POST", { hashes })).json()) as { matches: unknown[] };
    expect(after.matches).toEqual([]);
  });

  it("rejects an invalid phone hash on opt-in", async () => {
    expect((await call("/opt-in", "POST", { phoneHash: "+14155550134" })).status).toBe(400);
  });
});

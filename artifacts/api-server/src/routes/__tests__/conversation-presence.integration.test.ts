/**
 * Integration test (real DB): conversation payloads carry the other person's
 * activity status (`isOnline` / `lastActiveAt`) for Messages' green dot and
 * "Active now" — only when BOTH people share their status (Instagram's
 * "Show activity status" rule), never about the viewer themself.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, conversations, conversationParticipants } from "@workspace/db";

const ME = `presence-me-${process.pid}`;
const THEM = `presence-them-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = ME;
    next();
  },
}));

async function cleanup() {
  const rows = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(eq(conversationParticipants.userId, ME));
  for (const row of rows) {
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, row.id));
    await db.delete(conversations).where(eq(conversations.id, row.id));
  }
  await db.delete(users).where(eq(users.clerkId, ME));
  await db.delete(users).where(eq(users.clerkId, THEM));
}

type View = { participants: { userId: string; isOnline?: boolean; lastSeenAt?: string; avatarUri?: string }[] };

let server: Server;
let baseUrl = "";
let convId = "";

const them = (view: View) => view.participants.find((p) => p.userId === THEM)!;
const mine = (view: View) => view.participants.find((p) => p.userId === ME)!;

describe("conversation activity status", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([
      { clerkId: ME, email: `${ME}@example.test`, name: "Me", displayName: "Me", accountType: "buyer", onboardingComplete: true, lastActiveAt: new Date() },
      { clerkId: THEM, email: `${THEM}@example.test`, name: "Them", displayName: "Them", accountType: "seller", onboardingComplete: true, lastActiveAt: new Date(Date.now() - 60_000), profileImageUrl: "https://img.test/them.jpg" },
    ]);
    const [conv] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning();
    convId = conv.id;
    await db.insert(conversationParticipants).values([
      { conversationId: convId, userId: ME, name: "Me", accountType: "buyer" },
      { conversationId: convId, userId: THEM, name: "Them", accountType: "seller" },
    ]);
    if (!server) {
      const { default: conversationsRouter } = await import("../conversations");
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", conversationsRouter);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("shows the other person as online in the list and the thread, never the viewer", async () => {
    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json()) as View[];
    const row = list.find((c) => (c as any).id === convId)!;
    expect(them(row).isOnline).toBe(true);
    expect(them(row).lastSeenAt).toBeTruthy();
    expect(them(row).avatarUri).toBe("https://img.test/them.jpg");
    expect(mine(row).isOnline).toBeUndefined();

    const thread = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as View;
    expect(them(thread).isOnline).toBe(true);
  });

  it("is offline once their last activity is older than the window", async () => {
    await db.update(users).set({ lastActiveAt: new Date(Date.now() - 30 * 60_000) }).where(eq(users.clerkId, THEM));
    const thread = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as View;
    expect(them(thread).isOnline).toBe(false);
  });

  it("hides it when either person turned Show activity status off", async () => {
    await db.update(users).set({ showActivityStatus: false }).where(eq(users.clerkId, THEM));
    let thread = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as View;
    expect(them(thread)).toMatchObject({ isOnline: false });
    expect(them(thread).lastSeenAt).toBeUndefined();
    // The photo isn't activity status — it stays.
    expect(them(thread).avatarUri).toBe("https://img.test/them.jpg");

    await db.update(users).set({ showActivityStatus: true }).where(eq(users.clerkId, THEM));
    await db.update(users).set({ showActivityStatus: false }).where(eq(users.clerkId, ME));
    thread = await fetch(`${baseUrl}/api/conversations/${convId}`).then((r) => r.json()) as View;
    expect(them(thread).isOnline).toBe(false);
  });
});

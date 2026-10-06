/**
 * Account mutes — Instagram's "Mute" (migration 131).
 *
 *   GET    /api/social/mutes            — accounts I muted (newest first)
 *   POST   /api/social/mutes            — { userId, posts?, stories?, messages? } mute (idempotent; updates options)
 *   DELETE /api/social/mutes/:userId    — unmute
 *
 * The muted account is never told. Effects, all server-side so they hold on
 * every device: their posts leave my Following feed, their stories leave my
 * story tray, and their DMs stop notifying me (the thread still receives the
 * messages). It used to live only in AsyncStorage on one device and change
 * nothing on the server — the inbox swipe "Mute" said "Muted X" while every
 * message kept pushing.
 *
 * `:userId` / `userId` accept the Clerk id or the users.id alias.
 */
import { Router } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, accountMutes, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { resolveToClerkId } from "./public";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db.select().from(accountMutes)
    .where(eq(accountMutes.userId, myId))
    .orderBy(desc(accountMutes.createdAt))
    .limit(500);
  const people = rows.length === 0 ? [] : await db.select({
    clerkId: users.clerkId, name: users.name, displayName: users.displayName, brandName: users.brandName,
    username: users.username, accountType: users.accountType, avatarUrl: users.avatarUrl, profileImageUrl: users.profileImageUrl,
  }).from(users).where(inArray(users.clerkId, rows.map((r) => r.mutedUserId)));
  const byId = new Map(people.map((p) => [p.clerkId, p]));
  res.json(rows.map((r) => {
    const p = byId.get(r.mutedUserId);
    const name = (p?.accountType === "seller" ? p?.brandName : null) || p?.displayName || p?.name || "Brandthread member";
    return {
      mutedUserId: r.mutedUserId,
      name,
      handle: p?.username ? `@${p.username}` : "",
      avatarUrl: p?.profileImageUrl ?? p?.avatarUrl ?? null,
      posts: r.mutePosts,
      stories: r.muteStories,
      messages: r.muteMessages,
      createdAt: r.createdAt.toISOString(),
    };
  }));
});

router.post("/", rateLimit("mutation"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const body = req.body as { userId?: unknown; posts?: unknown; stories?: unknown; messages?: unknown };
  if (typeof body.userId !== "string" || !body.userId) { res.status(400).json({ error: "userId required" }); return; }
  const target = await resolveToClerkId(body.userId);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target === myId) { res.status(400).json({ error: "You can't mute yourself" }); return; }
  const options = {
    mutePosts: body.posts !== false,
    muteStories: body.stories !== false,
    muteMessages: body.messages !== false,
  };
  await db.insert(accountMutes).values({ userId: myId, mutedUserId: target, ...options })
    .onConflictDoUpdate({ target: [accountMutes.userId, accountMutes.mutedUserId], set: options });
  res.json({ ok: true, mutedUserId: target, posts: options.mutePosts, stories: options.muteStories, messages: options.muteMessages });
});

router.delete("/:userId", rateLimit("mutation"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const target = (await resolveToClerkId(req.params.userId as string)) ?? (req.params.userId as string);
  await db.delete(accountMutes).where(and(eq(accountMutes.userId, myId), eq(accountMutes.mutedUserId, target)));
  res.json({ ok: true });
});

export default router;

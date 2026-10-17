/**
 * Personal safety settings.
 *
 * GET    /api/safety/muted-words          — list my muted words and phrases
 * POST   /api/safety/muted-words          — { phrase } add one
 * DELETE /api/safety/muted-words/:phrase  — remove one
 * GET    /api/safety/mutes                 — people I muted
 * POST   /api/safety/mutes                 — { userId, mutePosts?, muteStories? } mute (or update) someone
 * DELETE /api/safety/mutes/:userId         — unmute
 * GET    /api/safety/restrictions          — people I restricted
 * POST   /api/safety/restrictions          — { userId } restrict someone
 * DELETE /api/safety/restrictions/:userId  — unrestrict
 *
 * Muted words hide matching comments and posts from the person who muted
 * them. Nobody else is affected and the author is never told. Muting a person
 * hides their posts, comments and/or stories from the muter only. Restricting
 * a person makes their comments on my posts visible only to them.
 */
import { Router } from "express";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db, mutedWords, userMutes, userRestrictions, accountMutes } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { profilesById } from "../lib/safety";
import { resolveToClerkId } from "./public";
import { MAX_MUTED_WORDS, MAX_MUTED_WORD_LENGTH, normalizeMutedPhrase } from "../lib/contentModerator";
import { cappedUnknown, looseBody, validateBody } from "../middlewares/bodySchemas";

const router = Router();

// Shape + size guard; normalizeMutedPhrase enforces MAX_MUTED_WORD_LENGTH after normalising.
const mutedWordBody = looseBody({ phrase: cappedUnknown(1_000) });
router.use(requireAuth);

router.get("/muted-words", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ phrase: mutedWords.phrase, createdAt: mutedWords.createdAt })
    .from(mutedWords)
    .where(eq(mutedWords.userId, userId))
    .orderBy(asc(mutedWords.phrase));
  res.json({
    words: rows.map((row) => ({ phrase: row.phrase, createdAt: row.createdAt.toISOString() })),
    limit: MAX_MUTED_WORDS,
  });
});

router.post("/muted-words", rateLimit("report"), validateBody(mutedWordBody), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const phrase = normalizeMutedPhrase((req.body as { phrase?: unknown })?.phrase);
  if (!phrase) {
    return res.status(400).json({
      error: `Enter a word or phrase up to ${MAX_MUTED_WORD_LENGTH} characters.`,
      code: "VALIDATION_ERROR",
    });
  }
  const [{ n }] = await db.select({ n: count() }).from(mutedWords).where(eq(mutedWords.userId, userId));
  if (Number(n) >= MAX_MUTED_WORDS) {
    return res.status(409).json({ error: `You can mute up to ${MAX_MUTED_WORDS} words.`, code: "LIMIT_REACHED" });
  }
  const [created] = await db.insert(mutedWords).values({ userId, phrase }).onConflictDoNothing().returning();
  return res.status(created ? 201 : 200).json({
    phrase,
    createdAt: (created?.createdAt ?? new Date()).toISOString(),
    alreadyMuted: !created,
  });
});

router.delete("/muted-words/:phrase", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const phrase = normalizeMutedPhrase(decodeURIComponent(String(req.params.phrase)));
  if (!phrase) return res.status(400).json({ error: "Unknown phrase" });
  await db.delete(mutedWords).where(and(eq(mutedWords.userId, userId), eq(mutedWords.phrase, phrase)));
  return res.json({ ok: true });
});

// ─── People: mute & restrict ─────────────────────────────────────────────────

const MAX_PERSON_LIST = 1000;

/** Resolve the target person (Clerk id or users.id alias); null = unknown or self. */
async function resolveTarget(raw: unknown, myId: string): Promise<{ id: string } | { error: string; status: number }> {
  if (typeof raw !== "string" || !raw.trim()) return { error: "userId required", status: 400 };
  const id = await resolveToClerkId(raw.trim());
  if (!id) return { error: "User not found", status: 404 };
  if (id === myId) return { error: "You can't do this to your own account.", status: 400 };
  return { id };
}

async function personRows<T extends { userId: string; createdAt: Date }>(rows: T[]) {
  const profiles = await profilesById(rows.map((r) => r.userId));
  return rows.map((r) => {
    const p = profiles.get(r.userId);
    return {
      ...r,
      name: p?.deleted ? "Deleted account" : p?.name ?? "Brandthread member",
      handle: p?.handle ?? "",
      initials: p?.initials ?? "BM",
      avatarUrl: p?.avatarUrl ?? null,
      accountType: p?.accountType ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

router.get("/mutes", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ userId: userMutes.mutedId, mutePosts: userMutes.mutePosts, muteStories: userMutes.muteStories, createdAt: userMutes.createdAt })
    .from(userMutes)
    .where(eq(userMutes.muterId, myId))
    .orderBy(desc(userMutes.createdAt))
    .limit(MAX_PERSON_LIST);
  const legacy = await db.select({ userId: accountMutes.mutedUserId, mutePosts: accountMutes.mutePosts,
    muteStories: accountMutes.muteStories, createdAt: accountMutes.createdAt })
    .from(accountMutes).where(eq(accountMutes.userId, myId)).limit(MAX_PERSON_LIST);
  const combined = [...new Map([...legacy, ...rows].map(row => [row.userId, row])).values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, MAX_PERSON_LIST);
  res.json({ mutes: await personRows(combined) });
});

router.post("/mutes", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as { userId?: unknown; mutePosts?: unknown; muteStories?: unknown };
  if ((body.mutePosts !== undefined && typeof body.mutePosts !== "boolean")
    || (body.muteStories !== undefined && typeof body.muteStories !== "boolean")) {
    return res.status(400).json({ error: "mutePosts and muteStories must be true or false", code: "VALIDATION_ERROR" });
  }
  const mutePosts = body.mutePosts ?? true;
  const muteStories = body.muteStories ?? true;
  if (!mutePosts && !muteStories) {
    return res.status(400).json({ error: "Choose posts, stories or both to mute.", code: "VALIDATION_ERROR" });
  }
  const target = await resolveTarget(body.userId, myId);
  if ("error" in target) return res.status(target.status).json({ error: target.error });
  const row = await db.transaction(async tx => {
    const [saved] = await tx.insert(userMutes)
      .values({ muterId: myId, mutedId: target.id, mutePosts, muteStories })
      .onConflictDoUpdate({ target: [userMutes.muterId, userMutes.mutedId], set: { mutePosts, muteStories } })
      .returning();
    await tx.insert(accountMutes).values({ userId: myId, mutedUserId: target.id, mutePosts, muteStories })
      .onConflictDoUpdate({ target: [accountMutes.userId, accountMutes.mutedUserId], set: { mutePosts, muteStories } });
    return saved!;
  });
  return res.status(201).json({
    userId: row.mutedId, mutePosts: row.mutePosts, muteStories: row.muteStories, createdAt: row.createdAt.toISOString(),
  });
});

router.delete("/mutes/:userId", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const raw = String(req.params.userId);
  const target = (await resolveToClerkId(raw)) ?? raw;
  await db.transaction(async tx => {
    await tx.delete(userMutes).where(and(eq(userMutes.muterId, myId), eq(userMutes.mutedId, target)));
    await tx.delete(accountMutes).where(and(eq(accountMutes.userId, myId), eq(accountMutes.mutedUserId, target)));
  });
  return res.json({ ok: true });
});

router.get("/restrictions", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ userId: userRestrictions.restrictedId, createdAt: userRestrictions.createdAt })
    .from(userRestrictions)
    .where(eq(userRestrictions.restrictorId, myId))
    .orderBy(desc(userRestrictions.createdAt))
    .limit(MAX_PERSON_LIST);
  res.json({ restrictions: await personRows(rows) });
});

router.post("/restrictions", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const target = await resolveTarget((req.body as { userId?: unknown } | undefined)?.userId, myId);
  if ("error" in target) return res.status(target.status).json({ error: target.error });
  const [created] = await db.insert(userRestrictions)
    .values({ restrictorId: myId, restrictedId: target.id })
    .onConflictDoNothing()
    .returning();
  return res.status(created ? 201 : 200).json({
    userId: target.id, createdAt: (created?.createdAt ?? new Date()).toISOString(), alreadyRestricted: !created,
  });
});

router.delete("/restrictions/:userId", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const raw = String(req.params.userId);
  const target = (await resolveToClerkId(raw)) ?? raw;
  await db.delete(userRestrictions).where(and(eq(userRestrictions.restrictorId, myId), eq(userRestrictions.restrictedId, target)));
  return res.json({ ok: true });
});

export default router;

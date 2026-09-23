/**
 * Personal safety settings.
 *
 * GET    /api/safety/muted-words          — list my muted words and phrases
 * POST   /api/safety/muted-words          — { phrase } add one
 * DELETE /api/safety/muted-words/:phrase  — remove one
 *
 * Muted words hide matching comments and posts from the person who muted
 * them. Nobody else is affected and the author is never told.
 */
import { Router } from "express";
import { and, asc, count, eq } from "drizzle-orm";
import { db, mutedWords } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { MAX_MUTED_WORDS, MAX_MUTED_WORD_LENGTH, normalizeMutedPhrase } from "../lib/contentModerator";

const router = Router();
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

router.post("/muted-words", async (req, res) => {
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

export default router;

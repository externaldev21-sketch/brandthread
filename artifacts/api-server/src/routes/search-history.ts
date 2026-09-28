/**
 * Buyer search history — server-side, per user (Search rebuild, replacing
 * the old buyer-search.tsx purely-local AsyncStorage list).
 * GET    /api/buyer/search-history        — list, most recent first, capped to 5
 * POST   /api/buyer/search-history        — remember a term (case-insensitive upsert)
 * DELETE /api/buyer/search-history/:term  — remove one term
 * DELETE /api/buyer/search-history        — clear all
 */
import { Router } from "express";
import { db, searchHistory } from "@workspace/db";
import type { InferSelectModel } from "drizzle-orm";
import { eq, and, desc, sql } from "drizzle-orm";

type SearchHistoryRow = InferSelectModel<typeof searchHistory>;
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

const HISTORY_LIMIT = 5;

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(searchHistory)
    .where(eq(searchHistory.userId, userId))
    .orderBy(desc(searchHistory.searchedAt))
    .limit(HISTORY_LIMIT);
  return res.json(rows.map((r: SearchHistoryRow) => ({ term: r.term, searchedAt: r.searchedAt })));
});

router.post("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { term } = req.body as { term?: string };
  const trimmed = (term ?? "").trim();
  if (!trimmed) return res.status(400).json({ error: "term required" });

  const [existing] = await db.select().from(searchHistory)
    .where(and(eq(searchHistory.userId, userId), sql`lower(${searchHistory.term}) = lower(${trimmed})`))
    .limit(1);

  if (existing) {
    await db.update(searchHistory)
      .set({ searchedAt: new Date() })
      .where(eq(searchHistory.id, existing.id));
  } else {
    await db.insert(searchHistory).values({ userId, term: trimmed });
  }

  const rows = await db.select().from(searchHistory)
    .where(eq(searchHistory.userId, userId))
    .orderBy(desc(searchHistory.searchedAt))
    .limit(HISTORY_LIMIT);
  return res.status(201).json(rows.map((r: SearchHistoryRow) => ({ term: r.term, searchedAt: r.searchedAt })));
});

router.delete("/:term", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const term = decodeURIComponent(req.params.term);
  await db.delete(searchHistory)
    .where(and(eq(searchHistory.userId, userId), sql`lower(${searchHistory.term}) = lower(${term})`));
  return res.json({ ok: true });
});

router.delete("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(searchHistory).where(eq(searchHistory.userId, userId));
  return res.json({ ok: true });
});

export default router;

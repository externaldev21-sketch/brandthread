/**
 * Seller messaging tools: canned replies + away auto-reply settings.
 *
 * GET    /api/seller/quick-replies        — my saved replies
 * POST   /api/seller/quick-replies        — create { title, body, shortcut? }
 * PUT    /api/seller/quick-replies/:id    — edit
 * DELETE /api/seller/quick-replies/:id    — delete
 * GET    /api/seller/away-message         — my away auto-reply settings
 * PUT    /api/seller/away-message         — save settings
 *
 * Everything is scoped to the signed-in seller's own id.
 */
import { Router } from "express";
import { db, users, sellerQuickReplies, sellerAwaySettings } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { QUICK_REPLY_LIMIT, validateQuickReply } from "../lib/quickReplies";
import { validateAwayInput } from "../lib/awaySchedule";
import { loadAwaySettings } from "../lib/awayAutoReply";
import { boundedBody, cappedUnknown, validateBody } from "../middlewares/bodySchemas";

export const quickRepliesRouter = Router();

// Shape + size guards; validateQuickReply / validateAwayInput keep their limits.
const quickReplyBody = boundedBody({ title: cappedUnknown(5_000), body: cappedUnknown(20_000) }, 100_000);
const awayMessageBody = boundedBody({ message: cappedUnknown(20_000), mode: cappedUnknown(40) }, 100_000);
export const awayMessageRouter = Router();
quickRepliesRouter.use(requireAuth);
awayMessageRouter.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isSeller(userId: string): Promise<boolean> {
  const [u] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, userId)).limit(1);
  return u?.accountType === "seller";
}

function view(r: typeof sellerQuickReplies.$inferSelect) {
  return { id: r.id, title: r.title, body: r.body, shortcut: r.shortcut, updatedAt: r.updatedAt.toISOString() };
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string; cause?: { code?: string } })?.code === "23505"
    || (e as { cause?: { code?: string } })?.cause?.code === "23505";
}

quickRepliesRouter.get("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  if (!(await isSeller(sellerId))) return res.status(403).json({ error: "Sellers only." });
  const rows = await db.select().from(sellerQuickReplies)
    .where(eq(sellerQuickReplies.sellerId, sellerId))
    .orderBy(asc(sellerQuickReplies.createdAt));
  return res.json({ quickReplies: rows.map(view), limit: QUICK_REPLY_LIMIT });
});

quickRepliesRouter.post("/", rateLimit("mutation"), validateBody(quickReplyBody), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  if (!(await isSeller(sellerId))) return res.status(403).json({ error: "Sellers only." });
  const v = validateQuickReply(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sellerQuickReplies)
    .where(eq(sellerQuickReplies.sellerId, sellerId));
  if (n >= QUICK_REPLY_LIMIT) {
    return res.status(409).json({ error: `You can save up to ${QUICK_REPLY_LIMIT} quick replies.`, code: "QUICK_REPLY_LIMIT" });
  }
  try {
    const [row] = await db.insert(sellerQuickReplies).values({ sellerId, ...v.value }).returning();
    return res.status(201).json(view(row!));
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: "You already use that shortcut.", code: "SHORTCUT_TAKEN" });
    throw e;
  }
});

quickRepliesRouter.put("/:id", rateLimit("mutation"), validateBody(quickReplyBody), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params as { id: string };
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Quick reply not found." });
  const v = validateQuickReply(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const [row] = await db.update(sellerQuickReplies)
      .set({ ...v.value, updatedAt: new Date() })
      .where(and(eq(sellerQuickReplies.id, id), eq(sellerQuickReplies.sellerId, sellerId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Quick reply not found." });
    return res.json(view(row));
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: "You already use that shortcut.", code: "SHORTCUT_TAKEN" });
    throw e;
  }
});

quickRepliesRouter.delete("/:id", rateLimit("mutation"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params as { id: string };
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Quick reply not found." });
  const deleted = await db.delete(sellerQuickReplies)
    .where(and(eq(sellerQuickReplies.id, id), eq(sellerQuickReplies.sellerId, sellerId)))
    .returning({ id: sellerQuickReplies.id });
  if (deleted.length === 0) return res.status(404).json({ error: "Quick reply not found." });
  return res.json({ ok: true });
});

awayMessageRouter.get("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  if (!(await isSeller(sellerId))) return res.status(403).json({ error: "Sellers only." });
  const s = await loadAwaySettings(sellerId);
  return res.json({
    enabled: s?.enabled ?? false,
    message: s?.message ?? "",
    mode: s?.mode ?? "always",
    timezone: s?.timezone ?? "UTC",
    openDays: s?.openDays ?? 62,
    openMinute: s?.openMinute ?? 540,
    closeMinute: s?.closeMinute ?? 1020,
  });
});

awayMessageRouter.put("/", rateLimit("mutation"), validateBody(awayMessageBody), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  if (!(await isSeller(sellerId))) return res.status(403).json({ error: "Sellers only." });
  const v = validateAwayInput(req.body ?? {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  const now = new Date();
  // updatedAt doubles as the "always" window identity, so every save starts a
  // fresh window (re-enabling replies to buyers again).
  await db.insert(sellerAwaySettings)
    .values({ sellerId, ...v.value, updatedAt: now })
    .onConflictDoUpdate({ target: sellerAwaySettings.sellerId, set: { ...v.value, updatedAt: now } });
  return res.json(v.value);
});

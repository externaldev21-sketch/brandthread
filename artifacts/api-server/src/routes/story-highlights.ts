/**
 * Story highlights (server-backed) + the author's story archive.
 *
 * GET    /api/social/highlights/me                     — my highlights with items
 * GET    /api/social/highlights/user/:userId           — someone's highlights (audience + block aware)
 * GET    /api/social/highlights/stories                — my live + archived stories to pick from
 * GET    /api/social/highlights/:id                    — one highlight, items as story-shaped slides
 * POST   /api/social/highlights                        — create { title, cover*, storyIds? }
 * PATCH  /api/social/highlights/:id                    — rename / cover / position
 * DELETE /api/social/highlights/:id
 * POST   /api/social/highlights/:id/items              — add { storyId } (my live or archived story)
 * DELETE /api/social/highlights/:id/items/:itemId
 *
 * Items snapshot the story's media (URLs only — the cleanup job never deletes
 * media objects) and the audience it was posted to, so a highlight outlives
 * the 24 h story. A Close Friends / friends-only item is returned only to
 * members of that audience. Deleting a story early or removing it in
 * moderation also removes its highlight items (see social.ts / reportTargets.ts).
 */
import { Router } from "express";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  db, users, stories, storyArchive, storyHighlights, storyHighlightItems,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { blockRelation, publishingRestriction } from "../lib/safety";
import { evaluateContent } from "../lib/contentModerator";
import { audienceAllows, normalizeAudience, viewerRelations } from "../lib/storyAccess";
import { resolveToClerkId } from "./public";

export const MAX_HIGHLIGHTS = 50;
export const MAX_HIGHLIGHT_ITEMS = 100;
const MAX_TITLE = 24;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth);

type HighlightRow = typeof storyHighlights.$inferSelect;
type ItemRow = typeof storyHighlightItems.$inferSelect;

function thumbOf(media: unknown): string | null {
  const items = Array.isArray(media) ? media : [];
  const pick = (m: any) => (typeof m?.imageUri === "string" ? m.imageUri : typeof m?.thumbnailUri === "string" ? m.thumbnailUri : typeof m?.url === "string" ? m.url : null);
  return items.map(pick).find((u) => !!u) ?? null;
}

function itemView(i: ItemRow) {
  return {
    id: i.id,
    storyId: i.storyId,
    media: i.media,
    visibility: i.visibility,
    thumbnailUrl: thumbOf(i.media),
    storyCreatedAt: i.storyCreatedAt ? new Date(i.storyCreatedAt).getTime() : null,
    position: i.position,
  };
}

function highlightView(h: HighlightRow, items: ItemRow[]) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    id: h.id,
    userId: h.userId,
    title: h.title,
    coverUrl: h.coverUrl ?? (sorted[0] ? thumbOf(sorted[0].media) : null),
    coverEmoji: h.coverEmoji,
    coverColor: h.coverColor,
    position: h.position,
    itemCount: sorted.length,
    items: sorted.map(itemView),
    createdAt: new Date(h.createdAt).getTime(),
    updatedAt: new Date(h.updatedAt).getTime(),
  };
}

async function itemsByHighlight(ids: string[]) {
  const map = new Map<string, ItemRow[]>();
  if (!ids.length) return map;
  const rows = await db.select().from(storyHighlightItems)
    .where(inArray(storyHighlightItems.highlightId, ids))
    .orderBy(asc(storyHighlightItems.position), asc(storyHighlightItems.createdAt));
  for (const r of rows) {
    if (!map.has(r.highlightId)) map.set(r.highlightId, []);
    map.get(r.highlightId)!.push(r);
  }
  return map;
}

function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}
const cleanEmoji = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 8) : null);
const cleanColor = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
function cleanCoverUrl(v: unknown): string | null {
  return typeof v === "string" && /^(https:\/\/|\/objects\/|\/api\/storage\/)/.test(v) && v.length <= 1000 ? v : null;
}

function titleRejected(title: string): string | null {
  const d = evaluateContent(title, "dm");
  return d.action === "reject" ? d.reason : null;
}

/** Snapshot of one of my stories (live, else archived), or null. */
async function loadMyStorySnapshot(myId: string, storyId: string) {
  const [live] = await db.select().from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.authorId, myId))).limit(1);
  if (live) {
    if (live.moderationStatus === "removed") return null;
    return { storyId, media: (Array.isArray(live.media) ? live.media : []) as unknown[], visibility: normalizeAudience(live.privacyVisibility), createdAt: live.createdAt };
  }
  const [arch] = await db.select().from(storyArchive)
    .where(and(eq(storyArchive.storyId, storyId), eq(storyArchive.authorId, myId))).limit(1);
  if (!arch) return null;
  return { storyId, media: (Array.isArray(arch.media) ? arch.media : []) as unknown[], visibility: normalizeAudience(arch.visibility), createdAt: arch.storyCreatedAt };
}

async function addItem(highlightId: string, myId: string, storyId: string): Promise<"added" | "exists" | "missing" | "full"> {
  const snap = await loadMyStorySnapshot(myId, storyId);
  if (!snap) return "missing";
  const existing = await db.select({ id: storyHighlightItems.id, storyId: storyHighlightItems.storyId })
    .from(storyHighlightItems).where(eq(storyHighlightItems.highlightId, highlightId));
  if (existing.some((e) => e.storyId === storyId)) return "exists";
  if (existing.length >= MAX_HIGHLIGHT_ITEMS) return "full";
  const inserted = await db.insert(storyHighlightItems).values({
    highlightId, storyId, media: snap.media, visibility: snap.visibility,
    storyCreatedAt: snap.createdAt, position: existing.length,
  }).onConflictDoNothing().returning({ id: storyHighlightItems.id });
  if (inserted.length) await db.update(storyHighlights).set({ updatedAt: new Date() }).where(eq(storyHighlights.id, highlightId));
  return inserted.length ? "added" : "exists";
}

async function ownHighlight(myId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(storyHighlights)
    .where(and(eq(storyHighlights.id, id), eq(storyHighlights.userId, myId))).limit(1);
  return row ?? null;
}

// ─── Reads ────────────────────────────────────────────────────────────────────
router.get("/highlights/me", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db.select().from(storyHighlights)
    .where(eq(storyHighlights.userId, myId))
    .orderBy(asc(storyHighlights.position), desc(storyHighlights.createdAt));
  const items = await itemsByHighlight(rows.map((r) => r.id));
  res.json(rows.map((r) => highlightView(r, items.get(r.id) ?? [])));
});

/** Stories I can put in a highlight: live ones first, then the archive. */
router.get("/highlights/stories", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const limit = Math.min(parseInt(String(req.query.limit ?? "60"), 10) || 60, 120);
  const [live, archived] = await Promise.all([
    db.select().from(stories)
      .where(and(eq(stories.authorId, myId), gt(stories.expiresAt, new Date()), ne(stories.moderationStatus, "removed")))
      .orderBy(desc(stories.createdAt)).limit(limit),
    db.select().from(storyArchive).where(eq(storyArchive.authorId, myId))
      .orderBy(desc(storyArchive.storyCreatedAt)).limit(limit),
  ]);
  const liveIds = new Set(live.map((r) => r.id));
  const all = [
    ...live.map((r) => ({ storyId: r.id, media: r.media as unknown[], visibility: normalizeAudience(r.privacyVisibility), createdAt: r.createdAt, live: true })),
    ...archived.filter((r) => !liveIds.has(r.storyId))
      .map((r) => ({ storyId: r.storyId, media: r.media as unknown[], visibility: normalizeAudience(r.visibility), createdAt: r.storyCreatedAt, live: false })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
  res.json(all.map((s) => ({
    storyId: s.storyId, thumbnailUrl: thumbOf(s.media), slides: Array.isArray(s.media) ? s.media.length : 0,
    visibility: s.visibility, createdAt: new Date(s.createdAt).getTime(), live: s.live,
  })));
});

async function visibleHighlightsOf(viewerId: string, ownerId: string) {
  if (ownerId !== viewerId && (await blockRelation(viewerId, ownerId)) !== "none") return null;
  const [owner] = await db.select({ deletedAt: users.deletedAt, suspendedAt: users.suspendedAt })
    .from(users).where(eq(users.clerkId, ownerId)).limit(1);
  if (!owner || owner.deletedAt || owner.suspendedAt) return null;
  const rows = await db.select().from(storyHighlights)
    .where(eq(storyHighlights.userId, ownerId))
    .orderBy(asc(storyHighlights.position), desc(storyHighlights.createdAt));
  const itemMap = await itemsByHighlight(rows.map((r) => r.id));
  const rel = await viewerRelations(viewerId, [ownerId]);
  const out: Array<{ row: HighlightRow; items: ItemRow[] }> = [];
  for (const row of rows) {
    const items = (itemMap.get(row.id) ?? []).filter((i) => audienceAllows(i.visibility, ownerId, viewerId, rel));
    // A viewer never sees a highlight whose every item is outside their audience.
    if (ownerId !== viewerId || items.length > 0 || (itemMap.get(row.id) ?? []).length === 0) {
      if (ownerId !== viewerId && items.length === 0) continue;
      out.push({ row, items });
    }
  }
  return out;
}

router.get("/highlights/user/:userId", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const ownerId = await resolveToClerkId(String(req.params.userId));
  if (!ownerId) { res.json([]); return; }
  const list = await visibleHighlightsOf(myId, ownerId);
  res.json((list ?? []).map(({ row, items }) => highlightView(row, items)));
});

/** One highlight with items shaped like story slides so the story viewer can play it. */
router.get("/highlights/:id", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Highlight not found" }); return; }
  const [row] = await db.select().from(storyHighlights).where(eq(storyHighlights.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Highlight not found" }); return; }
  const list = await visibleHighlightsOf(myId, row.userId);
  const found = list?.find((h) => h.row.id === id);
  if (!found) { res.status(404).json({ error: "Highlight not found" }); return; }

  const [author] = await db.select().from(users).where(eq(users.clerkId, row.userId)).limit(1);
  const name = (author?.accountType === "seller" ? author.brandName : null) || author?.displayName || author?.name || "Brandthread member";
  const parts = name.trim().split(/\s+/);
  const initials = (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
  const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const view = highlightView(row, found.items);
  res.json({
    ...view,
    stories: view.items.map((i) => ({
      id: i.id,
      authorId: row.userId,
      authorName: name,
      authorHandle: author?.username ? `@${author.username}` : "",
      authorInitials: initials,
      authorColor: "#1C1C1E",
      authorAccountType: author?.accountType ?? "buyer",
      media: i.media,
      repliesDisabled: true,
      privacy: { visibility: "public", replyPermission: "everyone", hiddenFromUserIds: [], closeFriendsOnly: i.visibility !== "public" },
      viewers: [],
      likesCount: 0,
      viewsCount: 0,
      likedByMe: false,
      originalStoryId: null,
      originalAuthorId: null,
      createdAt: i.storyCreatedAt ?? Date.now(),
      expiresAt: farFuture,
    })),
  });
});

// ─── Writes (owner only) ──────────────────────────────────────────────────────
router.post("/highlights", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const restriction = await publishingRestriction(myId);
  if (restriction) { res.status(restriction.status).json(restriction.body); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = cleanTitle(body.title) ?? "";
  const rejected = titleRejected(title);
  if (rejected) { res.status(422).json({ error: rejected, code: "CONTENT_REJECTED" }); return; }
  const storyIds = Array.isArray(body.storyIds) ? (body.storyIds as unknown[]).filter((s): s is string => typeof s === "string" && UUID_RE.test(s)).slice(0, MAX_HIGHLIGHT_ITEMS) : [];

  const [{ n }] = await db.select({ n: sql<number>`cast(count(*) as int)` }).from(storyHighlights).where(eq(storyHighlights.userId, myId));
  if (n >= MAX_HIGHLIGHTS) {
    res.status(400).json({ error: `You can keep up to ${MAX_HIGHLIGHTS} highlights`, code: "HIGHLIGHT_LIMIT" }); return;
  }
  const [row] = await db.insert(storyHighlights).values({
    userId: myId, title,
    coverUrl: cleanCoverUrl(body.coverUrl), coverEmoji: cleanEmoji(body.coverEmoji), coverColor: cleanColor(body.coverColor),
    position: n,
  }).returning();
  for (const sid of storyIds) await addItem(row.id, myId, sid);
  const items = await itemsByHighlight([row.id]);
  res.status(201).json(highlightView(row, items.get(row.id) ?? []));
});

router.patch("/highlights/:id", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const row = await ownHighlight(myId, String(req.params.id));
  if (!row) { res.status(404).json({ error: "Highlight not found" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<typeof storyHighlights.$inferInsert> = { updatedAt: new Date() };
  if ("title" in body) {
    const title = cleanTitle(body.title);
    if (title === null) { res.status(400).json({ error: "Invalid title", code: "VALIDATION_ERROR" }); return; }
    const rejected = titleRejected(title);
    if (rejected) { res.status(422).json({ error: rejected, code: "CONTENT_REJECTED" }); return; }
    patch.title = title;
  }
  if ("coverUrl" in body) patch.coverUrl = cleanCoverUrl(body.coverUrl);
  if ("coverEmoji" in body) patch.coverEmoji = cleanEmoji(body.coverEmoji);
  if ("coverColor" in body) patch.coverColor = cleanColor(body.coverColor);
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0 && body.position < 10_000) patch.position = body.position;
  const [updated] = await db.update(storyHighlights).set(patch).where(eq(storyHighlights.id, row.id)).returning();
  const items = await itemsByHighlight([row.id]);
  res.json(highlightView(updated, items.get(row.id) ?? []));
});

router.delete("/highlights/:id", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const row = await ownHighlight(myId, String(req.params.id));
  if (!row) { res.status(404).json({ error: "Highlight not found" }); return; }
  await db.delete(storyHighlights).where(eq(storyHighlights.id, row.id));
  res.json({ id: row.id, deleted: true });
});

router.post("/highlights/:id/items", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const row = await ownHighlight(myId, String(req.params.id));
  if (!row) { res.status(404).json({ error: "Highlight not found" }); return; }
  const storyId = (req.body as { storyId?: unknown })?.storyId;
  if (typeof storyId !== "string" || !UUID_RE.test(storyId)) {
    res.status(400).json({ error: "storyId required", code: "VALIDATION_ERROR" }); return;
  }
  const result = await addItem(row.id, myId, storyId);
  if (result === "missing") { res.status(404).json({ error: "Story not found", code: "STORY_UNAVAILABLE" }); return; }
  if (result === "full") { res.status(400).json({ error: `A highlight holds up to ${MAX_HIGHLIGHT_ITEMS} stories`, code: "HIGHLIGHT_FULL" }); return; }
  const items = await itemsByHighlight([row.id]);
  res.status(result === "added" ? 201 : 200).json(highlightView(row, items.get(row.id) ?? []));
});

router.delete("/highlights/:id/items/:itemId", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const row = await ownHighlight(myId, String(req.params.id));
  const itemId = String(req.params.itemId);
  if (!row || !UUID_RE.test(itemId)) { res.status(404).json({ error: "Highlight not found" }); return; }
  const removed = await db.delete(storyHighlightItems)
    .where(and(eq(storyHighlightItems.id, itemId), eq(storyHighlightItems.highlightId, row.id)))
    .returning({ id: storyHighlightItems.id });
  if (!removed.length) { res.status(404).json({ error: "Item not found" }); return; }
  res.json({ id: itemId, deleted: true });
});

export default router;

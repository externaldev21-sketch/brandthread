/**
 * Interactive story stickers.
 *
 * POST /api/social/stories/:id/poll-vote                  — { overlayId, optionIndex }  (viewer, not the author)
 * POST /api/social/stories/:id/question-answer            — { overlayId, answer }       (viewer, not the author)
 * GET  /api/social/stories/:id/question-answers           — author only: every answer, grouped by question
 * POST /api/social/stories/:id/question-reply-conversation — author only: { userId } -> the DM to reply in
 *
 * Results (`stickerState`) come back on every story payload (see lib/storyStickers.ts).
 * Product and countdown stickers have no endpoints of their own: their data rides
 * on `stickerState`, and "Notify me" reuses POST /api/public/drops/:id/notify.
 */
import { Router } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db, follows, stories, storyMentions, storyPollVotes, storyQuestionAnswers, users,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { blockRelation, blockedUserIds, profilesById, publishingRestriction } from "../lib/safety";
import { evaluateContent } from "../lib/contentModerator";
import { ensureStoryReplyConversation } from "../lib/storyMentions";
import { notifyStoryQuestionAnswer } from "../lib/activityEvents";
import { QUESTION_ANSWER_MAX, withStickerState } from "../lib/storyStickers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAuth);
router.param("id", (_req, _res, next, value) => {
  if (!UUID_RE.test(String(value))) { next("route"); return; }
  next();
});

type StoryRow = typeof stories.$inferSelect;

async function loadLiveStory(id: string): Promise<StoryRow | null> {
  const [row] = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
  if (!row || row.moderationStatus === "removed" || new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

/**
 * May this viewer open this story? Same rules as GET /stories/:id: not blocked,
 * follows the author (or was tagged in a story that is not Close Friends), and
 * inside the story's audience ('friends' = mutual follows, 'close_friends' = on
 * the author's close_friends list).
 */
async function viewerMayOpen(viewerId: string, row: StoryRow): Promise<boolean> {
  if (row.authorId === viewerId) return true;
  if ((await blockRelation(viewerId, row.authorId)) !== "none") return false;
  const audience = row.privacyVisibility;
  if (audience === "close_friends") {
    try {
      const res = await db.execute(sql`SELECT 1 FROM close_friends WHERE user_id = ${row.authorId} AND friend_id = ${viewerId} LIMIT 1`);
      const rows = (res as any).rows ?? res;
      if (!(Array.isArray(rows) && rows.length > 0)) return false;
    } catch { return false; } // list table not present: never open a Close Friends story
  } else {
    const [tagged] = await db.select({ s: storyMentions.storyId }).from(storyMentions)
      .where(and(eq(storyMentions.storyId, row.id), eq(storyMentions.mentionedUserId, viewerId))).limit(1);
    if (tagged) return true;
  }
  const [follow] = await db.select({ f: follows.followerId }).from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, row.authorId))).limit(1);
  if (!follow) return false;
  if (audience === "friends") {
    const [back] = await db.select({ f: follows.followerId }).from(follows)
      .where(and(eq(follows.followerId, row.authorId), eq(follows.followingId, viewerId))).limit(1);
    if (!back) return false;
  }
  return true;
}

function findOverlay(row: StoryRow, overlayId: unknown, type: "poll" | "question"): any | null {
  if (typeof overlayId !== "string") return null;
  for (const m of (Array.isArray(row.media) ? row.media : []) as any[]) {
    for (const o of (Array.isArray(m?.overlays) ? m.overlays : []) as any[]) {
      if (o?.id === overlayId && o?.type === type) return o;
    }
  }
  return null;
}

const gone = (res: any) => res.status(404).json({ error: "Story unavailable", code: "STORY_UNAVAILABLE" });

async function stateFor(row: StoryRow, viewerId: string) {
  const [view] = await withStickerState([{ id: row.id, authorId: row.authorId, media: row.media }], viewerId);
  return view.stickerState;
}

// ─── Poll ─────────────────────────────────────────────────────────────────────
router.post("/stories/:id/poll-vote", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const row = await loadLiveStory(String(req.params.id));
  if (!row || !(await viewerMayOpen(myId, row))) { gone(res); return; }
  if (row.authorId === myId) {
    res.status(403).json({ error: "You can't vote on your own poll", code: "AUTHOR_CANNOT_VOTE" }); return;
  }
  const { overlayId, optionIndex } = (req.body ?? {}) as { overlayId?: unknown; optionIndex?: unknown };
  const poll = findOverlay(row, overlayId, "poll");
  if (!poll) { res.status(404).json({ error: "Poll not found", code: "STICKER_NOT_FOUND" }); return; }
  const options = Array.isArray(poll.pollOptions) ? poll.pollOptions.length : 0;
  if (typeof optionIndex !== "number" || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= options) {
    res.status(400).json({ error: "Invalid option", code: "VALIDATION_ERROR" }); return;
  }
  const inserted = await db.insert(storyPollVotes)
    .values({ storyId: row.id, overlayId: overlayId as string, userId: myId, optionIndex })
    .onConflictDoNothing().returning({ storyId: storyPollVotes.storyId });
  const stickerState = await stateFor(row, myId);
  if (inserted.length === 0) {
    res.status(409).json({ error: "You already voted", code: "ALREADY_VOTED", stickerState }); return;
  }
  res.status(201).json({ ok: true, stickerState });
});

// ─── Question ─────────────────────────────────────────────────────────────────
router.post("/stories/:id/question-answer", rateLimit("messaging"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const restriction = await publishingRestriction(myId);
  if (restriction) { res.status(restriction.status).json(restriction.body); return; }
  const row = await loadLiveStory(String(req.params.id));
  if (!row || !(await viewerMayOpen(myId, row))) { gone(res); return; }
  if (row.authorId === myId) {
    res.status(403).json({ error: "You can't answer your own question", code: "AUTHOR_CANNOT_ANSWER" }); return;
  }
  const { overlayId, answer: rawAnswer } = (req.body ?? {}) as { overlayId?: unknown; answer?: unknown };
  const question = findOverlay(row, overlayId, "question");
  if (!question) { res.status(404).json({ error: "Question not found", code: "STICKER_NOT_FOUND" }); return; }
  const answer = typeof rawAnswer === "string" ? rawAnswer.replace(/\s+/g, " ").trim() : "";
  if (!answer || answer.length > QUESTION_ANSWER_MAX) {
    res.status(400).json({ error: `Answer must be 1-${QUESTION_ANSWER_MAX} characters`, code: "VALIDATION_ERROR" }); return;
  }
  const decision = evaluateContent(answer, "dm");
  if (decision.action === "reject") {
    res.status(422).json({ error: decision.reason, category: decision.category, code: "CONTENT_REJECTED" }); return;
  }
  const inserted = await db.insert(storyQuestionAnswers)
    .values({ storyId: row.id, overlayId: overlayId as string, userId: myId, answer })
    .onConflictDoNothing().returning({ storyId: storyQuestionAnswers.storyId });
  const stickerState = await stateFor(row, myId);
  if (inserted.length === 0) {
    res.status(409).json({ error: "You already answered", code: "ALREADY_ANSWERED", stickerState }); return;
  }
  void notifyStoryQuestionAnswer({ storyId: row.id, answererId: myId, authorId: row.authorId, media: row.media });
  res.status(201).json({ ok: true, stickerState });
});

router.get("/stories/:id/question-answers", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(stories).where(eq(stories.id, String(req.params.id))).limit(1);
  if (!row) { gone(res); return; }
  if (row.authorId !== myId) { res.status(403).json({ error: "Only the author can see answers", code: "FORBIDDEN" }); return; }

  const answers = await db.select().from(storyQuestionAnswers)
    .where(eq(storyQuestionAnswers.storyId, row.id)).orderBy(asc(storyQuestionAnswers.createdAt));
  const blocked = await blockedUserIds(myId);
  const profiles = await profilesById(answers.map((a) => a.userId));
  const questions: Array<{ overlayId: string; prompt: string; answers: any[] }> = [];
  for (const m of (Array.isArray(row.media) ? row.media : []) as any[]) {
    for (const o of (Array.isArray(m?.overlays) ? m.overlays : []) as any[]) {
      if (o?.type !== "question" || typeof o.id !== "string") continue;
      questions.push({
        overlayId: o.id,
        prompt: String(o.questionPrompt ?? ""),
        answers: answers
          .filter((a) => a.overlayId === o.id && !blocked.has(a.userId) && !profiles.get(a.userId)?.deleted)
          .map((a) => {
            const p = profiles.get(a.userId);
            return {
              userId: a.userId, name: p?.name ?? "Brandthread member", handle: p?.handle ?? "",
              initials: p?.initials ?? "BM", avatarUrl: p?.avatarUrl ?? null,
              answer: a.answer, createdAt: new Date(a.createdAt).getTime(),
            };
          }),
      });
    }
  }
  res.json({ storyId: row.id, questions });
});

router.post("/stories/:id/question-reply-conversation", rateLimit("messaging"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const restriction = await publishingRestriction(myId);
  if (restriction) { res.status(restriction.status).json(restriction.body); return; }
  const [row] = await db.select().from(stories).where(eq(stories.id, String(req.params.id))).limit(1);
  if (!row) { gone(res); return; }
  if (row.authorId !== myId) { res.status(403).json({ error: "Only the author can reply to answers", code: "FORBIDDEN" }); return; }
  const userId = (req.body as { userId?: unknown })?.userId;
  if (typeof userId !== "string" || !userId) { res.status(400).json({ error: "userId required", code: "VALIDATION_ERROR" }); return; }
  const [answered] = await db.select({ u: storyQuestionAnswers.userId }).from(storyQuestionAnswers)
    .where(and(eq(storyQuestionAnswers.storyId, row.id), eq(storyQuestionAnswers.userId, userId))).limit(1);
  if (!answered) { res.status(404).json({ error: "No answer from that person", code: "NOT_FOUND" }); return; }
  const relation = await blockRelation(myId, userId);
  if (relation === "blocked_by_me") { res.status(403).json({ error: "You blocked this account. Unblock them to send a message.", code: "BLOCKED_BY_ME" }); return; }
  if (relation !== "none") { res.status(403).json({ error: "Unable to send message.", code: "BLOCKED" }); return; }
  const [target] = await db.select({ id: users.clerkId }).from(users)
    .where(and(eq(users.clerkId, userId), isNull(users.deletedAt), isNull(users.suspendedAt))).limit(1);
  if (!target) { res.status(404).json({ error: "Account not found", code: "NOT_FOUND" }); return; }
  const result = await ensureStoryReplyConversation(myId, userId);
  if (!result) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({
    conversationId: result.conversation.id,
    route: result.conversation.isRequest ? "requests" : "inbox",
    isRequest: result.conversation.isRequest,
  });
});

export default router;

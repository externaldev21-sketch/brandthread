/**
 * Brandthread Agent — the official AI friend account's chat backend.
 *
 * POST /api/brandthread-agent/message — send a message to the agent, get an
 *                                        AI reply (persisted like any other DM)
 *
 * This route (and lib/brandthreadAgent.ts, which it shares with the
 * onboarding welcome hook and the backfill script) must NEVER import or call
 * anything that moves or grants Thread Cash, Stripe, or checkout money. See
 * the header comment on lib/brandthreadAgent.ts and
 * __tests__/brandthread-agent-no-money.test.ts, which asserts this
 * statically, plus an integration test asserting a user's Thread Cash
 * balance is unchanged by any agent interaction.
 */
import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, conversations, conversationParticipants, messages, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { moderateMessage } from "../lib/contentModerator";
import {
  BRANDTHREAD_AGENT_CLERK_ID, BRANDTHREAD_AGENT_NAME, BRANDTHREAD_AGENT_INITIALS,
  BRANDTHREAD_AGENT_COLOR, isAgentConversation, composeThreadCashCard, composeDiscoverCard,
} from "../lib/brandthreadAgent";
import { logger } from "../lib/logger";
import {
  assistantAvailable, buildInboxAssistantPrompt, parseAssistantReply, composeLinkCard,
  ASSISTANT_OFFLINE_REPLY, ASSISTANT_UNREACHABLE_REPLY,
} from "../lib/brandthreadAssistant";

const router = Router();
router.use(requireAuth);

// Same model as Brandthread AI (/ai-brain, routes/ai.ts).
const CHAT_MODEL = "gpt-5.4-mini";
const MAX_HISTORY_MESSAGES = 16;
const MAX_INPUT_CHARS = 2000;

// Replies when the LLM can't answer are honest status messages, never a
// made-up answer — see ASSISTANT_OFFLINE_REPLY / ASSISTANT_UNREACHABLE_REPLY.
// The system prompt (buyer app guide, or the /ai-brain seller prompt +
// snapshot for sellers) lives in lib/brandthreadAssistant.ts.

async function loadHistory(conversationId: string) {
  const rows = await db
    .select({ senderId: messages.senderId, body: messages.body, moderationStatus: messages.moderationStatus })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);
  return rows
    .reverse()
    .filter((m) => m.moderationStatus !== "removed" && m.body)
    .map((m) => ({
      role: (m.senderId === BRANDTHREAD_AGENT_CLERK_ID ? "assistant" : "user") as "assistant" | "user",
      content: m.body,
    }));
}

/** Very small heuristic card picker — not a full recommendation engine, just
 *  enough to demo rich cards from real conversation intent. */
function pickCard(userText: string, accountType: "buyer" | "seller") {
  if (accountType !== "buyer") return undefined;
  const lower = userText.toLowerCase();
  if (lower.includes("thread cash")) return composeThreadCashCard();
  if (lower.includes("discover") || lower.includes("find me") || lower.includes("brands")) return composeDiscoverCard();
  return undefined;
}

router.post("/message", rateLimit("agent-chat"), async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const { conversationId, text } = req.body as { conversationId?: string; text?: string };

  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ error: "conversationId is required" });
    return;
  }
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Messages are limited to ${MAX_INPUT_CHARS} characters.` });
    return;
  }

  const [membership] = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  if (!(await isAgentConversation(conversationId))) {
    res.status(400).json({ error: "This is not a Brandthread Agent conversation" });
    return;
  }

  // Input moderation — same DM policy the human-to-human conversations
  // route enforces, so the agent never stores something a human DM would
  // have rejected.
  const inputDecision = moderateMessage(trimmed);
  if (inputDecision.blocked) {
    res.status(422).json({ error: inputDecision.reason ?? "That message can't be sent.", code: "MODERATED" });
    return;
  }

  const [me] = await db
    .select({ name: users.displayName, initials: users.username, accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const now = new Date();
  const [userMessage] = await db.insert(messages).values({
    conversationId,
    senderId: userId,
    senderName: me?.name ?? "",
    senderInitials: (me?.initials ?? "").slice(0, 2).toUpperCase(),
    senderColor: "#8B5CF6",
    body: trimmed,
    createdAt: now,
  }).returning();

  await db.update(conversations)
    .set({
      lastMessage: trimmed,
      lastMessageAt: now,
      updatedAt: now,
      // Signal to the client (via GET /api/conversations/:id) that a reply
      // is being generated — polled, no websocket layer exists yet.
      agentTypingUntil: new Date(Date.now() + 20_000),
    })
    .where(eq(conversations.id, conversationId));

  const accountType = me?.accountType === "seller" ? "seller" : "buyer";
  let replyText = ASSISTANT_OFFLINE_REPLY;
  let card: ReturnType<typeof composeThreadCashCard> | ReturnType<typeof composeLinkCard> | undefined;
  if (await assistantAvailable()) {
    replyText = ASSISTANT_UNREACHABLE_REPLY;
    try {
      // Imported lazily: the shared client throws at import time when its
      // env vars are missing, and assistantAvailable() has just checked them.
      const { openai } = await import("@workspace/integrations-openai-ai-server");
      const [history, systemPrompt] = await Promise.all([
        loadHistory(conversationId),
        buildInboxAssistantPrompt(userId, accountType),
      ]);
      const completion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        max_completion_tokens: 400,
      });
      const parsed = parseAssistantReply((completion.choices[0]?.message?.content ?? "").trim(), accountType);
      if (parsed.text) {
        // Output moderation — the reply must never contain anything the
        // ordinary DM moderator would reject.
        const outputDecision = moderateMessage(parsed.text);
        if (!outputDecision.blocked) {
          replyText = parsed.text;
          card = parsed.link ? composeLinkCard(parsed.link) : pickCard(trimmed, accountType);
        }
      }
    } catch (err) {
      logger.error({ err, conversationId }, "Brandthread Agent completion failed");
      replyText = ASSISTANT_UNREACHABLE_REPLY;
    }
  }

  const replyAt = new Date();
  const [agentMessage] = await db.insert(messages).values({
    conversationId,
    senderId: BRANDTHREAD_AGENT_CLERK_ID,
    senderName: BRANDTHREAD_AGENT_NAME,
    senderInitials: BRANDTHREAD_AGENT_INITIALS,
    senderColor: BRANDTHREAD_AGENT_COLOR,
    body: replyText,
    attachment: card ?? null,
    createdAt: replyAt,
  }).returning();

  await db.update(conversations)
    .set({ lastMessage: replyText, lastMessageAt: replyAt, updatedAt: replyAt, agentTypingUntil: null })
    .where(eq(conversations.id, conversationId));
  await db.update(conversationParticipants)
    .set({ unreadCount: 1 })
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)));

  res.status(201).json({
    userMessage: { id: userMessage.id, text: userMessage.body, ts: userMessage.createdAt!.getTime() },
    agentMessage: {
      id: agentMessage.id,
      text: agentMessage.body,
      attachment: agentMessage.attachment ?? undefined,
      ts: agentMessage.createdAt!.getTime(),
    },
  });
});

export default router;

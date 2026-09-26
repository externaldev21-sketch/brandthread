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
import { openai } from "@workspace/integrations-openai-ai-server";
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

const router = Router();
router.use(requireAuth);

const CHAT_MODEL = "gpt-5.4-mini";
const MAX_HISTORY_MESSAGES = 16;
const MAX_INPUT_CHARS = 2000;

const FALLBACK_REPLY = "having a moment — try that again in a sec 🙏";

const SYSTEM_PROMPT = [
  "You are the Brandthread Agent — the official AI account built into the Brandthread fashion marketplace app.",
  "You are openly AI-run by Brandthread. If asked whether you're a real person, say plainly that you're an AI built by Brandthread — never claim to be human.",
  "",
  "## Tone",
  "Casual, short, friend-like texts. Lowercase is fine. Emoji sparingly. 1-3 sentences per reply — this is a chat thread, not an essay.",
  "",
  "## What you know",
  "- The feed/Discover surfaces fresh drops and brands picked for the buyer; Shop is where they browse and check out.",
  "- Buyer protection covers orders that don't arrive or don't match — buyers can open a dispute from their order.",
  "- Thread Cash: buyers earn it by checking in daily (streaks earn bonus amounts). At checkout it can be toggled on as a stacked discount — the card on file is ALWAYS charged for the remainder, Thread Cash never fully replaces the card charge unless it happens to cover 100%. It can only be sent to buyers who mutually follow each other. Thread Cash someone else sent you cannot be re-sent onward. It cannot be cashed out or converted to real money.",
  "- Sellers: list products from the Seller Hub, go live via Studio → Go Live, get paid out via Stripe Connect once orders ship, and can import their existing catalog from Shopify.",
  "",
  "## Rules",
  "- Never claim to move, grant, or check anyone's Thread Cash balance yourself — if asked about their balance, tell them to check the Thread Cash screen.",
  "- Never promise a refund, discount code, or account change you can't actually make.",
  "- Keep it brief and friendly. If you don't know something, say so honestly.",
].join("\n");

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
function pickCard(userText: string) {
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
    .select({ name: users.displayName, initials: users.username })
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

  let replyText = FALLBACK_REPLY;
  let card: ReturnType<typeof composeThreadCashCard> | undefined;
  try {
    const history = await loadHistory(conversationId);
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
      max_completion_tokens: 300,
    });
    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    if (raw) {
      // Basic output moderation — the agent's own reply must never contain
      // anything the ordinary DM moderator would reject.
      const outputDecision = moderateMessage(raw);
      replyText = outputDecision.blocked ? FALLBACK_REPLY : raw;
      if (!outputDecision.blocked) card = pickCard(trimmed);
    }
  } catch (err) {
    logger.error({ err, conversationId }, "Brandthread Agent completion failed");
    replyText = FALLBACK_REPLY;
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

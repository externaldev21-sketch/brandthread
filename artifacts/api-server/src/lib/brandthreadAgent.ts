/**
 * Brandthread Agent — shared constants + the welcome-conversation lifecycle.
 *
 * IMPORTANT — never touches money. This module (and brandthread-agent.ts,
 * the chat route that imports it) must have ZERO imports of, or calls into,
 * anything under src/lib/threadCash/, src/lib/money/, src/routes/thread-cash.ts
 * or any Stripe/checkout money-moving code. It may only ever compose a
 * `thread_cash`-type message attachment that deep-links the client to the
 * real Thread Cash screen (`/thread-cash`) — see composeThreadCashCard()
 * below. This constraint is enforced by a static-import test
 * (__tests__/brandthread-agent-no-money.test.ts).
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, users, conversations, conversationParticipants, messages, agentConversations,
} from "@workspace/db";
import { logger } from "./logger";

/** The single well-known system account. Matches the preview seed's
 *  `participantUserId` (artifacts/mobile/lib/previewInboxData.ts) so real and
 *  preview data agree on the same id. */
export const BRANDTHREAD_AGENT_CLERK_ID = "brandthread-agent";
export const BRANDTHREAD_AGENT_NAME = "Brandthread Agent";
export const BRANDTHREAD_AGENT_HANDLE = "@brandthread";
export const BRANDTHREAD_AGENT_INITIALS = "BT";
export const BRANDTHREAD_AGENT_COLOR = "#0A0A0B";
export const AGENT_CONVERSATION_TYPE = "brandthread_agent";

export function isAgentUserId(userId: string | null | undefined): boolean {
  return userId === BRANDTHREAD_AGENT_CLERK_ID;
}

const AGENT_PARTICIPANT_ROW = {
  name: BRANDTHREAD_AGENT_NAME,
  handle: BRANDTHREAD_AGENT_HANDLE,
  initials: BRANDTHREAD_AGENT_INITIALS,
  color: BRANDTHREAD_AGENT_COLOR,
  accountType: "system",
} as const;

// ─── Welcome copy ──────────────────────────────────────────────────────────

export type AgentQuickReply = { label: string; value: string };

export interface WelcomeStep {
  text: string;
  /** Seconds after the previous message this one should feel like it
   *  arrived — used only to stagger `createdAt` server-side so the client's
   *  existing chronological rendering already looks paced without any
   *  client-side fake-typing logic for this historical backfill/onboarding
   *  path. (The *live* chat reply path additionally sets `agentTypingUntil`
   *  — see brandthread-agent.ts.) */
  delaySeconds: number;
}

export const BUYER_WELCOME_STEPS: WelcomeStep[] = [
  { text: "yo, welcome to Brandthread 👋", delaySeconds: 0 },
  { text: "I'm the Brandthread Agent, here 24/7 if you wanna talk fits, find brands, or figure anything out", delaySeconds: 3 },
  { text: "want me to show you how Thread Cash works?", delaySeconds: 6 },
];

export const SELLER_WELCOME_STEPS: WelcomeStep[] = [
  { text: "yo, welcome to Brandthread 👋", delaySeconds: 0 },
  { text: "I'm the Brandthread Agent — here 24/7 for listing products, going live, payouts, or pulling in your Shopify catalog", delaySeconds: 3 },
  { text: "want me to walk you through your first listing?", delaySeconds: 6 },
];

export const BUYER_WELCOME_QUICK_REPLIES: AgentQuickReply[] = [
  { label: "Show me Thread Cash", value: "Show me how Thread Cash works" },
  { label: "Find me brands", value: "Find me some brands I'd like" },
  { label: "How do I sell?", value: "How do I start selling on Brandthread?" },
  { label: "Just vibing", value: "Just vibing, no questions right now" },
];

export const SELLER_WELCOME_QUICK_REPLIES: AgentQuickReply[] = [
  { label: "List a product", value: "How do I list my first product?" },
  { label: "Go Live", value: "How does Go Live work?" },
  { label: "Payouts", value: "How do payouts work?" },
  { label: "Import from Shopify", value: "How do I import my Shopify catalog?" },
];

export function welcomeStepsFor(accountType: string | null | undefined): WelcomeStep[] {
  return accountType === "seller" ? SELLER_WELCOME_STEPS : BUYER_WELCOME_STEPS;
}

export function quickRepliesFor(accountType: string | null | undefined): AgentQuickReply[] {
  return accountType === "seller" ? SELLER_WELCOME_QUICK_REPLIES : BUYER_WELCOME_QUICK_REPLIES;
}

/** A generic agent card attachment (mobile: `MessageAttachmentType.agent_card`).
 *  Deep-links only — this composes DATA, never reads or writes any balance,
 *  order, or checkout state. */
export function composeAgentCard(input: {
  cardKind: "thread_cash" | "product" | "profile" | "discover";
  title: string;
  subtitle?: string;
  deepLink: string;
  extraMeta?: Record<string, string>;
}) {
  return {
    type: "agent_card" as const,
    title: input.title,
    subtitle: input.subtitle,
    meta: { cardKind: input.cardKind, deepLink: input.deepLink, ...input.extraMeta },
  };
}

/** "How Thread Cash works" explainer card — deep-links to the real screen.
 *  Never touches any Thread Cash balance or ledger. */
export function composeThreadCashCard() {
  return composeAgentCard({
    cardKind: "thread_cash",
    title: "How Thread Cash works",
    subtitle: "Check in daily to earn credit, stack it as a discount at checkout, or send it to friends you follow.",
    deepLink: "/thread-cash",
  });
}

/** "Go to Discover" card. */
export function composeDiscoverCard() {
  return composeAgentCard({
    cardKind: "discover",
    title: "Go to Discover",
    subtitle: "Fresh drops and brands picked for you.",
    deepLink: "/(buyer)/discover",
  });
}

/** A quick-reply chip row attachment (mobile: `MessageAttachmentType.quick_replies`). */
export function composeQuickRepliesAttachment(options: AgentQuickReply[]) {
  return { type: "quick_replies" as const, meta: { optionsJson: JSON.stringify(options) } };
}

// ─── Agent user lookup ─────────────────────────────────────────────────────

export async function getAgentUser() {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, BRANDTHREAD_AGENT_CLERK_ID))
    .limit(1);
  return row ?? null;
}

// ─── Welcome conversation (idempotent) ─────────────────────────────────────

export interface CreateWelcomeResult {
  created: boolean;
  conversationId: string;
}

/**
 * Creates (once) the welcome conversation + 2-3 staggered welcome messages
 * for a user. Safe to call more than once for the same user — the second
 * call is a no-op thanks to the `agent_conversations` primary-key-on-userId
 * ledger, which also makes concurrent calls race-safe (the loser's insert is
 * simply discarded by `onConflictDoNothing`).
 */
export async function createWelcomeConversationOnce(
  userId: string,
  accountType: "buyer" | "seller",
  myInfo: { name: string; handle: string; initials: string; color: string },
): Promise<CreateWelcomeResult> {
  const existing = await db
    .select({ conversationId: agentConversations.conversationId })
    .from(agentConversations)
    .where(eq(agentConversations.userId, userId))
    .limit(1);
  if (existing[0]) {
    return { created: false, conversationId: existing[0].conversationId };
  }

  const [conv] = await db.insert(conversations).values({
    type: AGENT_CONVERSATION_TYPE,
  }).returning();

  await db.insert(conversationParticipants).values([
    {
      conversationId: conv.id,
      userId,
      name: myInfo.name,
      handle: myInfo.handle,
      initials: myInfo.initials,
      color: myInfo.color,
      accountType,
    },
    {
      conversationId: conv.id,
      userId: BRANDTHREAD_AGENT_CLERK_ID,
      ...AGENT_PARTICIPANT_ROW,
    },
  ]);

  // Claim the ledger row BEFORE sending messages. If two requests race, only
  // one insert wins here; the loser deletes the conversation it just created
  // (harmless — nothing references it yet) and returns the winner's id.
  const [claimed] = await db.insert(agentConversations).values({
    userId,
    conversationId: conv.id,
    accountType,
  }).onConflictDoNothing().returning({ conversationId: agentConversations.conversationId });

  if (!claimed) {
    // Lost the race — clean up the orphaned conversation and point at the
    // winner's.
    await db.delete(conversations).where(eq(conversations.id, conv.id));
    const [winner] = await db
      .select({ conversationId: agentConversations.conversationId })
      .from(agentConversations)
      .where(eq(agentConversations.userId, userId))
      .limit(1);
    return { created: false, conversationId: winner!.conversationId };
  }

  const steps = welcomeStepsFor(accountType);
  const quickReplies = quickRepliesFor(accountType);
  const now = Date.now();
  let lastText = "";
  let lastAt = new Date(now);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const createdAt = new Date(now + step.delaySeconds * 1000);
    const isLast = i === steps.length - 1;
    await db.insert(messages).values({
      conversationId: conv.id,
      senderId: BRANDTHREAD_AGENT_CLERK_ID,
      senderName: AGENT_PARTICIPANT_ROW.name,
      senderInitials: AGENT_PARTICIPANT_ROW.initials,
      senderColor: AGENT_PARTICIPANT_ROW.color,
      body: step.text,
      // Quick replies ride along on the final welcome message only.
      attachment: isLast && quickReplies.length > 0
        ? composeQuickRepliesAttachment(quickReplies)
        : null,
      createdAt,
    });
    lastText = step.text;
    lastAt = createdAt;
  }

  await db.update(conversations)
    .set({ lastMessage: lastText, lastMessageAt: lastAt, updatedAt: lastAt })
    .where(eq(conversations.id, conv.id));

  await db.update(conversationParticipants)
    .set({ unreadCount: steps.length })
    .where(and(eq(conversationParticipants.conversationId, conv.id), eq(conversationParticipants.userId, userId)));

  await db.update(agentConversations)
    .set({ welcomeSentAt: lastAt })
    .where(eq(agentConversations.userId, userId));

  logger.info({ userId, accountType, conversationId: conv.id }, "Sent Brandthread Agent welcome");
  return { created: true, conversationId: conv.id };
}

/** True when the given conversation is the caller's Brandthread Agent thread. */
export async function isAgentConversation(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, BRANDTHREAD_AGENT_CLERK_ID),
    ))
    .limit(1);
  return !!row;
}

// ─── One-time backfill for existing users ──────────────────────────────────

export interface BackfillResult {
  scanned: number;
  created: number;
}

/**
 * Sends the welcome conversation to every existing user who doesn't have one
 * yet (onboarding-complete users only — matches the same real-role
 * requirement the onboarding hook has). Idempotent: running it twice
 * converges to zero new conversations on the second run, because each user
 * is individually gated by `createWelcomeConversationOnce`.
 */
export async function runAgentWelcomeBackfill(
  batchSize = 200,
  options?: { onlyClerkIds?: string[] },
): Promise<BackfillResult> {
  let scanned = 0;
  let created = 0;
  let cursor: string | null = null;

  for (;;) {
    const rows = await db
      .select({
        clerkId: users.clerkId,
        name: users.name,
        displayName: users.displayName,
        username: users.username,
        accountType: users.accountType,
      })
      .from(users)
      .leftJoin(agentConversations, eq(agentConversations.userId, users.clerkId))
      .where(and(
        eq(users.onboardingComplete, true),
        eq(users.isSystemAccount, false),
        or(eq(users.accountType, "buyer"), eq(users.accountType, "seller")),
        sql`${agentConversations.userId} IS NULL`,
        cursor ? sql`${users.clerkId} > ${cursor}` : undefined,
        // Test-only scoping — never passed by the real backfill script, which
        // must scan every user. Keeps the backfill's own test suite from
        // touching every other test file's fixture users in the shared test
        // database.
        options?.onlyClerkIds ? inArray(users.clerkId, options.onlyClerkIds) : undefined,
      ))
      .orderBy(users.clerkId)
      .limit(batchSize);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const name = row.displayName ?? row.name;
      const initials = name.trim().slice(0, 2).toUpperCase() || "U";
      const result = await createWelcomeConversationOnce(
        row.clerkId,
        row.accountType as "buyer" | "seller",
        {
          name,
          handle: row.username ? `@${row.username}` : "",
          initials,
          color: "#8B5CF6",
        },
      );
      if (result.created) created++;
    }

    cursor = rows[rows.length - 1].clerkId;
    if (rows.length < batchSize) break;
  }

  return { scanned, created };
}

// ─── Anti-spam gate for proactive nudges ───────────────────────────────────

/** Minimum time between two proactive (not user-initiated) nudges in the
 *  same conversation. Mutable in one place; not yet exposed as a per-user
 *  setting (see PR description). */
export const PROACTIVE_NUDGE_MIN_INTERVAL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days

/** True when a proactive nudge is allowed right now for this conversation. */
export async function canSendProactiveNudge(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ agentLastNudgeAt: conversations.agentLastNudgeAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return false;
  if (!row.agentLastNudgeAt) return true;
  return Date.now() - new Date(row.agentLastNudgeAt).getTime() >= PROACTIVE_NUDGE_MIN_INTERVAL_MS;
}

export async function recordProactiveNudge(conversationId: string): Promise<void> {
  await db.update(conversations)
    .set({ agentLastNudgeAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

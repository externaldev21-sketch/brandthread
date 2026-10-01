/**
 * Away auto-reply: after a buyer's message lands in a 1:1 conversation with a
 * seller who is currently "away" (see awaySchedule.ts), post the seller's
 * away message once per conversation per away window.
 *
 * Safety properties:
 *   - Idempotent: the (conversation_id, window_key) primary key on
 *     away_auto_replies is claimed with INSERT .. ON CONFLICT DO NOTHING
 *     before anything is posted, so concurrent sends can never double-reply.
 *   - Never loops: only called for human sends; the reply itself is inserted
 *     directly (not via the send route) and flagged `is_automated`, and any
 *     automated sender is refused by shouldConsiderAutoReply.
 *   - Never bypasses message requests: skipped while the conversation is a
 *     pending request (the seller hasn't accepted it yet).
 *   - Best effort: failures are swallowed by the caller and never block the
 *     buyer's own message.
 */
import { db, conversations, conversationParticipants, messages, users, sellerAwaySettings, awayAutoReplies } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getAwayState, shouldConsiderAutoReply, type AwaySettings, type AwayMode } from "./awaySchedule";
import { getSellerVacationStatus } from "./sellerAvailability";
import { isAgentUserId } from "./brandthreadAgent";

export async function loadAwaySettings(sellerId: string): Promise<AwaySettings | null> {
  const [row] = await db.select().from(sellerAwaySettings).where(eq(sellerAwaySettings.sellerId, sellerId)).limit(1);
  if (!row) return null;
  return {
    enabled: row.enabled,
    message: row.message,
    mode: (row.mode === "outside_hours" ? "outside_hours" : "always") as AwayMode,
    timezone: row.timezone,
    openDays: row.openDays,
    openMinute: row.openMinute,
    closeMinute: row.closeMinute,
    updatedAt: row.updatedAt,
  };
}

export async function maybeSendAwayAutoReply(args: {
  conversationId: string;
  senderId: string;
  /** Every participant other than the sender. */
  otherIds: string[];
  now?: Date;
}): Promise<{ sent: boolean }> {
  const { conversationId, senderId, otherIds } = args;
  const now = args.now ?? new Date();
  // 1:1 seller conversations only.
  if (otherIds.length !== 1) return { sent: false };
  const sellerId = otherIds[0]!;

  const [conv] = await db
    .select({ isRequest: conversations.isRequest })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return { sent: false };

  if (!shouldConsiderAutoReply({
    senderIsAutomated: false,
    senderId,
    sellerId,
    conversationIsRequest: conv.isRequest,
    isAgentSender: isAgentUserId(senderId),
  })) return { sent: false };

  const [seller] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, sellerId))
    .limit(1);
  if (seller?.accountType !== "seller") return { sent: false };

  const settings = await loadAwaySettings(sellerId);
  if (!settings || !settings.message.trim()) return { sent: false };
  const state = getAwayState(settings, now);
  if (!state.away || !state.windowKey) return { sent: false };

  // Vacation mode already tells buyers the seller is away (and blocks the
  // message outright) — don't stack a second reply on top of it.
  const vacation = await getSellerVacationStatus(sellerId, now);
  if (vacation.active) return { sent: false };

  // The previous message in this thread may itself be automated only if the
  // sender were the seller; guard anyway by claiming the window atomically.
  const claimed = await db
    .insert(awayAutoReplies)
    .values({ conversationId, windowKey: state.windowKey, sellerId })
    .onConflictDoNothing()
    .returning({ windowKey: awayAutoReplies.windowKey });
  if (claimed.length === 0) return { sent: false };

  const [participant] = await db
    .select()
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, sellerId)))
    .limit(1);
  if (!participant) return { sent: false };

  const body = settings.message.trim();
  await db.insert(messages).values({
    conversationId,
    senderId: sellerId,
    senderName: participant.name,
    senderInitials: participant.initials,
    senderColor: participant.color,
    body,
    attachments: [],
    status: "sent",
    deliveredAt: now,
    isAutomated: true,
  });
  await Promise.all([
    db.update(conversations)
      .set({ lastMessage: body.slice(0, 100), lastMessageAt: now, updatedAt: now })
      .where(eq(conversations.id, conversationId)),
    db.update(conversationParticipants)
      .set({ unreadCount: sql`unread_count + 1` })
      .where(and(eq(conversationParticipants.conversationId, conversationId), sql`user_id != ${sellerId}`)),
  ]);
  return { sent: true };
}

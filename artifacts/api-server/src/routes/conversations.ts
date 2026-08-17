/**
 * Brandthread DM conversations — with safety features:
 *   • Block enforcement: blocked users cannot create conversations or send messages
 *   • Content moderation: harmful content (harassment, spam/scam, explicit, hate) is rejected
 *   • Follow-based message requests: buyer↔buyer DMs from non-followers land in Requests
 *   • Accept / decline: recipients can accept (moves to inbox) or decline (deletes conversation)
 *
 * POST   /api/conversations                — create or reopen existing
 * GET    /api/conversations                — list my conversations
 * GET    /api/conversations/:id           — get single conversation
 * GET    /api/conversations/:id/messages  — paginated messages
 * POST   /api/conversations/:id/messages  — send message (moderated + block-gated)
 * PATCH  /api/conversations/:id/read      — mark read
 * PATCH  /api/conversations/:id/accept    — accept a message request
 * DELETE /api/conversations/:id           — decline / delete conversation
 */
import { Router } from "express";
import {
  db, conversations, conversationParticipants, messages, blocks, follows, users,
  products, orders,
} from "@workspace/db";
import { eq, and, desc, inArray, sql, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { moderateMessage } from "../lib/contentModerator";
import { publishNotification } from "./notifications-feed";

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function isBlockedBy(viewerId: string, targetId: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, viewerId)))
    .limit(1);
  return !!row;
}

async function isFollowedBy(followerId: string, targetId: string): Promise<boolean> {
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)))
    .limit(1);
  return !!row;
}

function buildConversationView(
  conv: typeof conversations.$inferSelect,
  parts: (typeof conversationParticipants.$inferSelect)[],
  myUserId: string,
) {
  const me = parts.find((p) => p.userId === myUserId);
  return {
    id:   conv.id,
    type: conv.type,
    participants: parts.map((p) => ({
      userId:      p.userId,
      name:        p.name,
      handle:      p.handle,
      initials:    p.initials,
      color:       p.color,
      accountType: p.accountType,
    })),
    lastMessage:        conv.lastMessage       ?? undefined,
    lastMessageTs:      conv.lastMessageAt
      ? new Date(conv.lastMessageAt).getTime()
      : undefined,
    unreadCount:        me?.unreadCount        ?? 0,
    isFriendshipActive: true,
    isArchived:         false,
    // Use the DB column — true only for follow-based pending requests
    isRequest:          conv.isRequest,
    requestedBy:        conv.requestedBy       ?? undefined,
    contextOrderId:     conv.contextOrderId    ?? undefined,
    contextOrderNumber: conv.contextOrderNumber ?? undefined,
    contextOrderStatus: conv.contextOrderStatus ?? undefined,
    contextProductId:   conv.contextProductId  ?? undefined,
    contextProductName: conv.contextProductName ?? undefined,
    contextSellerName:  conv.contextSellerName  ?? undefined,
    updatedAt: conv.updatedAt?.toISOString() ?? conv.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

function adaptMessage(m: typeof messages.$inferSelect) {
  return {
    id:             m.id,
    conversationId: m.conversationId,
    fromId:         m.senderId,
    fromName:       m.senderName,
    fromInitials:   m.senderInitials,
    fromColor:      m.senderColor,
    text:           m.body,
    attachment:     (m.attachment as any) ?? undefined,
    replyToId:      m.replyToId ?? undefined,
    replyPreview:   undefined,
    reactions:      [],
    status:         m.status,
    ts:             new Date(m.createdAt!).getTime(),
    deletedForMe:   false,
  };
}

// ─── GET /api/conversations ───────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;

  const myParts = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userId));

  if (myParts.length === 0) return res.json([]);

  const convIds = myParts.map((p) => p.conversationId);

  const [convs, allParts] = await Promise.all([
    db.select().from(conversations)
      .where(inArray(conversations.id, convIds))
      .orderBy(desc(conversations.updatedAt)),
    db.select().from(conversationParticipants)
      .where(inArray(conversationParticipants.conversationId, convIds)),
  ]);

  const partsByConv = new Map<string, typeof allParts>();
  for (const p of allParts) {
    if (!partsByConv.has(p.conversationId)) partsByConv.set(p.conversationId, []);
    partsByConv.get(p.conversationId)!.push(p);
  }

  return res.json(convs.map((c) => buildConversationView(c, partsByConv.get(c.id) ?? [], userId)));
});

// ─── POST /api/conversations ──────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const myUserId = (req as any).clerkUserId as string;
  const {
    type,
    participant,
    myInfo,
    contextOrderId, contextOrderNumber, contextOrderStatus,
    contextProductId, contextProductName, contextSellerName,
  } = req.body as {
    type: string;
    participant: { userId: string; name: string; handle: string; initials: string; color: string; accountType: string };
    myInfo?: { name: string; handle: string; initials: string; color: string; accountType: string };
    contextOrderId?: string;
    contextOrderNumber?: string;
    contextOrderStatus?: string;
    contextProductId?: string;
    contextProductName?: string;
    contextSellerName?: string;
  };

  if (!participant?.userId) return res.status(400).json({ error: "participant.userId required" });

  // ── Block check: recipient has blocked sender ─────────────────────────────
  if (await isBlockedBy(myUserId, participant.userId)) {
    return res.status(403).json({ error: "Unable to start this conversation.", code: "BLOCKED" });
  }

  // ── DM privacy: honour recipient's "who can message me" preference ────────
  if (type === "buyer_to_buyer") {
    const [recipientUser] = await db
      .select({ dmPrivacy: users.dmPrivacy })
      .from(users)
      .where(eq(users.clerkId, participant.userId))
      .limit(1);

    if (recipientUser?.dmPrivacy === "followers_only") {
      // Sender must be someone the recipient follows — otherwise refuse outright.
      const recipientFollowsSender = await isFollowedBy(participant.userId, myUserId);
      if (!recipientFollowsSender) {
        return res.status(403).json({
          error:  "This user only accepts messages from people they follow.",
          code:   "DM_RESTRICTED",
        });
      }
    }
  }

  // ── Dedupe: find existing conversation between these two users ────────────
  const [myParts, theirParts] = await Promise.all([
    db.select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, myUserId)),
    db.select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, participant.userId)),
  ]);

  const mySet = new Set(myParts.map((p) => p.conversationId));
  const shared = theirParts.filter((p) => mySet.has(p.conversationId)).map((p) => p.conversationId);

  if (shared.length > 0) {
    const whereClause = contextOrderId
      ? and(inArray(conversations.id, shared), eq(conversations.type, type), eq(conversations.contextOrderId, contextOrderId))
      : and(inArray(conversations.id, shared), eq(conversations.type, type), sql`${conversations.contextOrderId} IS NULL`);

    const existing = await db.select().from(conversations).where(whereClause).limit(1);

    if (existing.length > 0) {
      const parts = await db.select().from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, existing[0].id));
      return res.json(buildConversationView(existing[0], parts, myUserId));
    }
  }

  // ── Determine if this is a follow-based message request (buyer↔buyer) ─────
  // A DM from A→B is a request if B does NOT follow A.
  let isRequest = false;
  if (type === "buyer_to_buyer") {
    const recipientFollowsSender = await isFollowedBy(participant.userId, myUserId);
    isRequest = !recipientFollowsSender;
  }

  // ── Create new conversation ───────────────────────────────────────────────
  const [conv] = await db.insert(conversations).values({
    type,
    isRequest,
    requestedBy:        isRequest ? myUserId : null,
    contextOrderId:     contextOrderId    ?? null,
    contextOrderNumber: contextOrderNumber ?? null,
    contextOrderStatus: contextOrderStatus ?? null,
    contextProductId:   contextProductId   ?? null,
    contextProductName: contextProductName ?? null,
    contextSellerName:  contextSellerName  ?? null,
  }).returning();

  await db.insert(conversationParticipants).values([
    {
      conversationId: conv.id,
      userId:      myUserId,
      name:        myInfo?.name        ?? "",
      handle:      myInfo?.handle      ?? "",
      initials:    myInfo?.initials    ?? "",
      color:       myInfo?.color       ?? "#8B5CF6",
      accountType: myInfo?.accountType ?? "buyer",
    },
    {
      conversationId: conv.id,
      userId:      participant.userId,
      name:        participant.name,
      handle:      participant.handle,
      initials:    participant.initials,
      color:       participant.color,
      accountType: participant.accountType,
    },
  ]);

  const parts = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conv.id));

  return res.status(201).json(buildConversationView(conv, parts, myUserId));
});

// ─── GET /api/conversations/:id ───────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  const [[conv], parts] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.id, id)),
    db.select().from(conversationParticipants).where(eq(conversationParticipants.conversationId, id)),
  ]);

  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  return res.json(buildConversationView(conv, parts, userId));
});

// ─── GET /api/conversations/:id/messages ─────────────────────────────────────
router.get("/:id/messages", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const limit = Math.min(parseInt(String(req.query.limit ?? 50), 10), 100);
  const before = req.query.before as string | undefined;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(403).json({ error: "Not a participant" });

  const whereClause = before
    ? and(eq(messages.conversationId, id), sql`${messages.createdAt} < ${new Date(before)}`)
    : eq(messages.conversationId, id);

  const msgs = await db.select().from(messages)
    .where(whereClause)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return res.json(msgs.reverse().map(adaptMessage));
});

// ─── POST /api/conversations/:id/messages ────────────────────────────────────
router.post("/:id/messages", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const { text, attachment, replyToId } = req.body as {
    text: string;
    attachment?: any;
    replyToId?: string;
  };

  // Require either text or an attachment
  if (!text?.trim() && !attachment) return res.status(400).json({ error: "text or attachment required" });

  // ── Content moderation ───────────────────────────────────────────────────
  // Casual profanity passes freely; only genuinely harmful content is blocked.
  const modResult = text?.trim() ? moderateMessage(text) : { blocked: false };
  if (modResult.blocked) {
    return res.status(422).json({
      error:    modResult.reason ?? "Message was flagged by safety filters.",
      category: modResult.category,
      code:     "MODERATED",
    });
  }

  // ── Sender membership ────────────────────────────────────────────────────
  const [sender] = await db.select().from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!sender) return res.status(403).json({ error: "Not a participant" });

  // ── Block check: any other participant has blocked this sender ────────────
  const otherParts = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), sql`user_id != ${userId}`));

  const otherIds = otherParts.map((p) => p.userId);
  if (otherIds.length > 0) {
    // Check if sender is blocked by any recipient
    const blockRows = await db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(and(inArray(blocks.blockerId, otherIds), eq(blocks.blockedId, userId)))
      .limit(1);

    if (blockRows.length > 0) {
      return res.status(403).json({ error: "Unable to send message.", code: "BLOCKED" });
    }
  }

  // ── Attachment validation ────────────────────────────────────────────────
  if (attachment != null) {
    const att = attachment as { type?: string; title?: string; subtitle?: string; meta?: { productId?: string; orderId?: string } };
    const allowedTypes = ["product", "order", "post", "profile"];
    if (!att.type || !allowedTypes.includes(att.type)) {
      return res.status(400).json({ error: "Invalid attachment type." });
    }

    if (att.type === "product") {
      // productId is required and must belong to the sender with status 'active'
      const pid = att.meta?.productId;
      if (!pid) return res.status(400).json({ error: "Attachment product requires meta.productId." });
      const [product] = await db
        .select({ id: products.id, ownerId: products.ownerId, status: products.status })
        .from(products)
        .where(eq(products.id, pid))
        .limit(1);
      if (!product) return res.status(400).json({ error: "Attached product not found." });
      if (product.ownerId !== userId) return res.status(403).json({ error: "You can only attach your own products." });
      if (product.status !== "active") return res.status(400).json({ error: "Only active products can be attached." });
    }

    if (att.type === "order") {
      // For order attachments, orderId must match the conversation's contextOrderId
      // and the conversation must belong to the sender
      const [conv] = await db
        .select({ contextOrderId: conversations.contextOrderId })
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);
      const orderId = att.meta?.orderId ?? conv?.contextOrderId ?? null;
      if (!orderId) return res.status(400).json({ error: "No order linked to this conversation." });
      const [order] = await db
        .select({ id: orders.id, ownerId: orders.ownerId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      if (!order) return res.status(400).json({ error: "Attached order not found." });
      if (order.ownerId !== userId) return res.status(403).json({ error: "You can only attach your own orders." });
      // Normalize meta to include the validated orderId
      (att as any).meta = { ...((att as any).meta ?? {}), orderId };
    }
  }

  const bodyText = text?.trim() ?? "";
  const attachmentTitle = (attachment as any)?.title as string | undefined;
  const previewText = bodyText || (attachmentTitle ? `📎 ${attachmentTitle}` : "Attachment");

  const [msg] = await db.insert(messages).values({
    conversationId: id,
    senderId:       userId,
    senderName:     sender.name,
    senderInitials: sender.initials,
    senderColor:    sender.color,
    body:           bodyText,
    attachment:     attachment ?? null,
    replyToId:      replyToId ?? null,
    status:         "sent",
  }).returning();

  // Update conversation preview + increment other participants' unread
  await Promise.all([
    db.update(conversations)
      .set({ lastMessage: previewText.slice(0, 100), lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, id)),
    db.update(conversationParticipants)
      .set({ unreadCount: sql`unread_count + 1` })
      .where(and(eq(conversationParticipants.conversationId, id), sql`user_id != ${userId}`)),
  ]);

  // Notify each recipient of the new message (non-critical, fire-and-forget)
  if (otherIds.length > 0) {
    (async () => {
      try {
        const [conv] = await db.select({ type: conversations.type })
          .from(conversations).where(eq(conversations.id, id)).limit(1);
        // Map conversation type to the notification type the mobile client expects
        const notifType = conv?.type === "buyer_to_buyer" ? "new_friend_message" : "new_order_message";
        for (const recipientId of otherIds) {
          await publishNotification({
            userId:        recipientId,
            category:      "messages",
            type:          notifType,
            title:         `New message from ${sender.name || "someone"}`,
            body:          previewText.slice(0, 100),
            actorName:     sender.name,
            actorHandle:   sender.handle,
            actorInitials: sender.initials,
            actorColor:    sender.color,
            targetId:      id,
            targetType:    "conversation",
          });
        }
      } catch { /* non-critical */ }
    })();
  }

  return res.status(201).json(adaptMessage(msg));
});

// ─── PATCH /api/conversations/:id/read ───────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  await db.update(conversationParticipants)
    .set({ unreadCount: 0, lastReadAt: new Date() })
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)));

  return res.json({ ok: true });
});

// ─── PATCH /api/conversations/:id/accept — accept a message request ───────────
// Only the recipient (non-requester participant) may accept.
router.patch("/:id/accept", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  // Only the recipient (not the requester) can accept
  if (conv.requestedBy === userId) {
    return res.status(403).json({ error: "Only the recipient can accept a message request." });
  }

  await db.update(conversations)
    .set({ isRequest: false, requestedBy: null, updatedAt: new Date() })
    .where(eq(conversations.id, id));

  const parts = await db.select().from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, id));
  const [updated] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);

  return res.json(buildConversationView(updated, parts, userId));
});

// ─── DELETE /api/conversations/:id — decline / delete conversation ────────────
router.delete("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [isMember] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)))
    .limit(1);

  if (!isMember) return res.status(404).json({ error: "Conversation not found" });

  // Hard-delete: cascade removes participants + messages
  await db.delete(conversations).where(eq(conversations.id, id));
  return res.json({ ok: true });
});

export default router;

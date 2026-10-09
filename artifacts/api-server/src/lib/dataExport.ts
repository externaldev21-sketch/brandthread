import {
  db, users, orders, orderItems, conversationParticipants, conversations, messages,
  follows, posts, savedItems, buyerAddresses, blocks,
} from "@workspace/db";
import { eq, inArray, or, asc } from "drizzle-orm";
import { signDmMessageMedia } from "./dmMedia";

const DM_MEDIA_EXPORT_URL_TTL_SEC = 7 * 24 * 60 * 60;

export const INSTANT_EXPORT_CATEGORIES = ["profile", "orders", "messages"] as const;
export const EMAIL_EXPORT_CATEGORIES = [
  "profile", "orders", "messages", "follows", "posts", "saved", "addresses", "blocks",
] as const;

/** Keep only known, de-duplicated string categories. */
export function normalizeExportCategories(requested: unknown, allowed: readonly string[]): string[] {
  const list = Array.isArray(requested) ? requested : [];
  return [...new Set(list.filter((key): key is string => typeof key === "string" && allowed.includes(key)))];
}

/**
 * Builds the portability export for one account. The profile/orders/messages
 * sections are the exact queries the instant POST /auth/data-export has always
 * run (extracted verbatim); the remaining sections only serve the emailed export.
 */
export async function buildAccountDataExport(
  clerkUserId: string,
  include: readonly string[],
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  if (include.includes("profile")) {
    const [profile] = await db.select({
      clerkId: users.clerkId,
      email: users.email,
      name: users.name,
      displayName: users.displayName,
      accountType: users.accountType,
      username: users.username,
      bio: users.bio,
      website: users.website,
      brandName: users.brandName,
      brandType: users.brandType,
      brandStage: users.brandStage,
      notificationPreferences: users.notificationPreferences,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
    result.profile = profile ?? null;
  }

  if (include.includes("orders")) {
    const ownedOrders = await db.select().from(orders)
      .where(or(eq(orders.buyerId, clerkUserId), eq(orders.ownerId, clerkUserId)))
      .orderBy(asc(orders.createdAt));
    const orderIds = ownedOrders.map((order) => order.id);
    const items = orderIds.length
      ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
      : [];
    const itemsByOrder = new Map<string, typeof items>();
    for (const item of items) {
      const group = itemsByOrder.get(item.orderId) ?? [];
      group.push(item);
      itemsByOrder.set(item.orderId, group);
    }
    result.orders = ownedOrders.map(({ riskLevel, riskScore, riskFlags, riskReviewed, ...order }) => ({
      ...order,
      items: itemsByOrder.get(order.id) ?? [],
      relationship: order.buyerId === clerkUserId ? "buyer" : "seller",
    }));
  }

  if (include.includes("messages")) {
    const memberships = await db.select({
      conversationId: conversationParticipants.conversationId,
    }).from(conversationParticipants).where(eq(conversationParticipants.userId, clerkUserId));
    const conversationIds = memberships.map((membership) => membership.conversationId);
    const conversationRows = conversationIds.length
      ? await db.select().from(conversations).where(inArray(conversations.id, conversationIds)).orderBy(asc(conversations.createdAt))
      : [];
    const messageRows = conversationIds.length
      ? await db.select({
          id: messages.id,
          conversationId: messages.conversationId,
          senderId: messages.senderId,
          senderName: messages.senderName,
          body: messages.body,
          attachment: messages.attachment,
          attachments: messages.attachments,
          replyToId: messages.replyToId,
          status: messages.status,
          deliveredAt: messages.deliveredAt,
          readAt: messages.readAt,
          deletedAt: messages.deletedAt,
          createdAt: messages.createdAt,
        }).from(messages).where(inArray(messages.conversationId, conversationIds)).orderBy(asc(messages.createdAt))
      : [];
    // Private DM media is exported as signed URLs (the account is a participant
    // of every conversation listed); 7 days, the longest a signed URL can live,
    // so an emailed export is still usable after it is downloaded.
    await signDmMessageMedia(messageRows, { ttlSec: DM_MEDIA_EXPORT_URL_TTL_SEC });
    result.messages = { conversations: conversationRows, messages: messageRows };
  }

  if (include.includes("follows")) {
    const [following, followers] = await Promise.all([
      db.select().from(follows).where(eq(follows.followerId, clerkUserId)),
      db.select().from(follows).where(eq(follows.followingId, clerkUserId)),
    ]);
    result.follows = { following, followers };
  }
  if (include.includes("posts")) {
    result.posts = await db.select().from(posts).where(eq(posts.userId, clerkUserId)).orderBy(asc(posts.createdAt));
  }
  if (include.includes("saved")) {
    result.saved = await db.select().from(savedItems).where(eq(savedItems.userId, clerkUserId)).orderBy(asc(savedItems.createdAt));
  }
  if (include.includes("addresses")) {
    result.addresses = await db.select().from(buyerAddresses).where(eq(buyerAddresses.buyerId, clerkUserId)).orderBy(asc(buyerAddresses.createdAt));
  }
  if (include.includes("blocks")) {
    result.blocks = await db.select().from(blocks).where(eq(blocks.blockerId, clerkUserId));
  }
  return result;
}

/**
 * Deterministic two-account world for the social E2E UI harness: a seller
 * with real published posts (one tagging a real product), a buyer who
 * follows them, and a buyer↔seller conversation. Idempotent — re-running
 * replaces the previous seed for the same ids. Emails are @example.test so
 * the test-data purge always sweeps them.
 */
import { inArray, or, sql } from "drizzle-orm";
import {
  db, users, follows, posts, products, productVariants, postTaggedProducts,
  conversations, conversationParticipants, messages, interactions, savedItems, notificationsFeed,
} from "@workspace/db";

export type SeedResult = { postIds: string[]; productId: string; conversationId: string };

export async function seedSocialE2e(opts: { buyer: string; seller: string; mediaBase: string }): Promise<SeedResult> {
  const { buyer, seller, mediaBase } = opts;
  const ids = [buyer, seller];

  // Clean any previous seed for these accounts.
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
  await db.delete(savedItems).where(inArray(savedItems.userId, ids));
  await db.delete(interactions).where(inArray(interactions.userId, ids));
  await db.execute(sql`DELETE FROM conversations c WHERE EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.user_id IN (${buyer}, ${seller}))`);
  await db.delete(posts).where(inArray(posts.userId, ids));
  await db.execute(sql`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE owner_id = ${seller})`);
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(follows).where(or(inArray(follows.followerId, ids), inArray(follows.followingId, ids)));
  await db.delete(users).where(inArray(users.clerkId, ids));

  const now = new Date();
  await db.insert(users).values([
    {
      clerkId: buyer, email: `${buyer}@example.test`, name: "Maya Brooks", displayName: "Maya Brooks",
      username: "mayabrooks", accountType: "buyer", onboardingComplete: true, termsAcceptedAt: now,
      feedGesturesTipSeenVersion: 99,
    } as any,
    {
      clerkId: seller, email: `${seller}@example.test`, name: "Atelier North", displayName: "Atelier North",
      brandName: "Atelier North", username: "ateliernorth", accountType: "seller", onboardingComplete: true,
      termsAcceptedAt: now, verified: true, verificationStatus: "verified", feedGesturesTipSeenVersion: 99,
      bio: "Small-batch outerwear, cut in Portland.",
    } as any,
  ]);
  await db.insert(follows).values({ followerId: buyer, followingId: seller });

  const [product] = await db.insert(products).values({
    ownerId: seller, name: "Wool Field Jacket", category: "outerwear", status: "active",
    images: [`${mediaBase}/fashion_runway_02.jpg`],
  } as any).returning({ id: products.id });
  await db.insert(productVariants).values({ productId: product.id, sku: `e2e-jacket-${seller}`, priceCents: 18_500, stock: 12 });

  const media = ["fashion_runway_01", "fashion_runway_02", "fashion_runway_03", "fashion_runway_05"];
  const postIds: string[] = [];
  for (let i = 0; i < media.length; i += 1) {
    const [post] = await db.insert(posts).values({
      userId: seller,
      mediaUrl: `${mediaBase}/${media[i]}.jpg`,
      thumbnailUrl: `${mediaBase}/${media[i]}.jpg`,
      mediaType: "photo",
      caption: ["Fall drop is live", "Field jacket, waxed", "Studio day", "Behind the seams"][i],
      hashtags: ["outerwear", "smallbatch"],
      createdAt: new Date(now.getTime() - i * 3_600_000),
    } as any).returning({ id: posts.id });
    postIds.push(post.id);
  }
  await db.insert(postTaggedProducts).values({ postId: postIds[0], productId: product.id, position: 0 });

  const [conv] = await db.insert(conversations).values({
    type: "buyer_to_seller_product", lastMessage: "Does it run true to size?", lastMessageAt: now, isRequest: false,
  } as any).returning({ id: conversations.id });
  await db.insert(conversationParticipants).values([
    { conversationId: conv.id, userId: buyer, name: "Maya Brooks", handle: "@mayabrooks", initials: "MB", color: "#3D3D42", accountType: "buyer" },
    { conversationId: conv.id, userId: seller, name: "Atelier North", handle: "@ateliernorth", initials: "AN", color: "#333338", accountType: "seller", unreadCount: 1 },
  ]);
  await db.insert(messages).values({ conversationId: conv.id, senderId: buyer, body: "Does it run true to size?" } as any);

  return { postIds, productId: product.id, conversationId: conv.id };
}

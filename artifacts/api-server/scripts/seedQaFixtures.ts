#!/usr/bin/env -S tsx
/**
 * QA crawl fixture seed.
 *
 * Populates a local Postgres (pointed to by DATABASE_URL) with a realistic,
 * idempotent dataset for manually / automatically crawling the mobile app in
 * buyer, seller and guest states:
 *
 *   - one buyer account
 *   - one seller account with a store (storefront row + profile fields)
 *   - 12 products, each with 2-3 variants, stock levels and images
 *   - 10 feed videos (posts, media_type = 'video')
 *   - one order per distinct status the schema/state machine supports
 *     (pending, processing, label_purchasing, fulfilled, shipped, delivered,
 *     cancelled, refund_pending)
 *   - a buyer<->seller conversation with a few messages
 *   - a follow (buyer follows seller)
 *   - a handful of notifications for both accounts
 *   - a Thread Cash balance (ledger entries) for the buyer
 *
 * All rows are namespaced with the `qa-seed:` clerkId / email / SKU prefixes
 * below so this script is safe to re-run: it deletes anything it previously
 * created before recreating it (delete-then-insert, wrapped so it never
 * touches unrelated data — see QA_SEED_TAG).
 *
 * IMPORTANT: this data is NOT wired to real Clerk accounts. There is no Clerk
 * user with these clerkIds. It exists so API routes that read `req.clerkUserId`
 * *if* that check is bypassed (see docs/qa/full-crawl-report.md "Harness"
 * section for how the crawler fakes a signed-in session) return real,
 * non-empty content instead of empty states.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm tsx scripts/seedQaFixtures.ts
 */
import { db, pool } from "@workspace/db";
import {
  users,
  products,
  productVariants,
  posts,
  orders,
  orderItems,
  conversations,
  conversationParticipants,
  messages,
  follows,
  notificationsFeed,
  storefronts,
} from "@workspace/db";
import { threadCashEntries, threadCashStreaks } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const QA_SEED_TAG = "qa-seed";

const BUYER_CLERK_ID = `${QA_SEED_TAG}-buyer-1`;
const SELLER_CLERK_ID = `${QA_SEED_TAG}-seller-1`;
const BUYER_EMAIL = "qa-seed-buyer@example.test";
const SELLER_EMAIL = "qa-seed-seller@example.test";

const PLACEHOLDER_IMG = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/1000`;
const PLACEHOLDER_VIDEO =
  "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const ORDER_STATUSES = [
  "pending",
  "processing",
  "label_purchasing",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refund_pending",
] as const;

async function wipePriorSeed() {
  // Delete children first (no ON DELETE CASCADE across all of these).
  const priorUserIds = [BUYER_CLERK_ID, SELLER_CLERK_ID];

  const priorOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.ownerId, SELLER_CLERK_ID));
  const priorOrderIds = priorOrders.map((o) => o.id);
  if (priorOrderIds.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, priorOrderIds));
    await db.delete(orders).where(inArray(orders.id, priorOrderIds));
  }

  const priorConvos = await db
    .select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, priorUserIds));
  const priorConvoIds = [...new Set(priorConvos.map((c) => c.id))];
  if (priorConvoIds.length) {
    await db.delete(messages).where(inArray(messages.conversationId, priorConvoIds));
    await db
      .delete(conversationParticipants)
      .where(inArray(conversationParticipants.conversationId, priorConvoIds));
    await db.delete(conversations).where(inArray(conversations.id, priorConvoIds));
  }

  const priorProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.ownerId, SELLER_CLERK_ID));
  const priorProductIds = priorProducts.map((p) => p.id);
  if (priorProductIds.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, priorProductIds));
    await db.delete(products).where(inArray(products.id, priorProductIds));
  }

  await db.delete(posts).where(inArray(posts.userId, priorUserIds));
  await db.delete(follows).where(inArray(follows.followerId, priorUserIds));
  await db.delete(follows).where(inArray(follows.followingId, priorUserIds));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, priorUserIds));
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, priorUserIds));
  await db.delete(threadCashStreaks).where(inArray(threadCashStreaks.buyerId, priorUserIds));
  await db.delete(storefronts).where(eq(storefronts.ownerId, SELLER_CLERK_ID));
  await db.delete(users).where(inArray(users.clerkId, priorUserIds));
}

async function main() {
  console.log(`Seeding QA fixtures into ${process.env.DATABASE_URL}`);
  await wipePriorSeed();

  // ── Buyer ──────────────────────────────────────────────────────────────
  const [buyer] = await db
    .insert(users)
    .values({
      clerkId: BUYER_CLERK_ID,
      email: BUYER_EMAIL,
      name: "Jamie Buyer",
      role: "buyer",
      accountType: "buyer",
      displayName: "Jamie",
      bio: "QA seed buyer account — loves streetwear drops.",
      username: "qa_jamie_buyer",
      onboardingComplete: true,
      buyerStyleInterests: ["streetwear", "minimalist", "vintage"],
    })
    .returning();

  // ── Seller + store ────────────────────────────────────────────────────
  const [seller] = await db
    .insert(users)
    .values({
      clerkId: SELLER_CLERK_ID,
      email: SELLER_EMAIL,
      name: "Riverside Studio",
      role: "seller",
      accountType: "seller",
      displayName: "Riverside Studio",
      bio: "QA seed seller — small-batch apparel studio.",
      username: "qa_riverside_studio",
      brandName: "Riverside Studio",
      brandType: "apparel",
      brandStage: "growing",
      onboardingComplete: true,
      verified: true,
      verificationStatus: "verified",
      category: "apparel",
      tags: ["streetwear", "handmade"],
      location: "Portland, OR",
      contactEmail: SELLER_EMAIL,
      subscriptionStatus: "active",
      subscriptionPlanId: "starter",
    })
    .returning();

  await db.insert(storefronts).values({
    ownerId: SELLER_CLERK_ID,
    slug: "qa-riverside-studio",
    title: "Riverside Studio",
    subtitle: "Small-batch apparel, made to last.",
    description: "QA seed storefront for crawl testing.",
    status: "published",
    publishedAt: new Date(),
  });

  // ── Products (12) with variants, stock, images ───────────────────────
  const PRODUCT_NAMES = [
    "Heavyweight Crewneck",
    "Selvedge Denim Jacket",
    "Cropped Hoodie",
    "Waffle Knit Long Sleeve",
    "Relaxed Cargo Pants",
    "Canvas Tote Bag",
    "Graphic Tee — Wave",
    "Fleece Half-Zip",
    "Ribbed Beanie",
    "Utility Vest",
    "Wide Leg Jeans",
    "Coach Jacket",
  ];

  const productRows = [];
  for (let i = 0; i < PRODUCT_NAMES.length; i++) {
    const name = PRODUCT_NAMES[i];
    const seedKey = `qa-product-${i + 1}`;
    productRows.push({
      ownerId: SELLER_CLERK_ID,
      name,
      description: `${name} — seeded QA product #${i + 1} for crawl testing.`,
      category: "apparel",
      status: "active" as const,
      images: [PLACEHOLDER_IMG(`${seedKey}-a`), PLACEHOLDER_IMG(`${seedKey}-b`)],
      tags: ["qa-seed", "apparel"],
      styleTags: i % 2 === 0 ? ["streetwear"] : ["minimalist"],
    });
  }
  const insertedProducts = await db.insert(products).values(productRows).returning();

  const SIZES = ["S", "M", "L", "XL"];
  const COLORS = ["Black", "Sand", "Olive"];
  let skuCounter = 1;
  for (const product of insertedProducts) {
    const variantCount = 2 + (skuCounter % 2); // 2 or 3 variants
    const variantRows = [];
    for (let v = 0; v < variantCount; v++) {
      variantRows.push({
        productId: product.id,
        size: SIZES[v % SIZES.length],
        color: COLORS[v % COLORS.length],
        sku: `QA-${QA_SEED_TAG}-${skuCounter}-${v}`.toUpperCase(),
        priceCents: 4500 + skuCounter * 150,
        // Vary stock so listing/low-stock/out-of-stock UI states all appear.
        stock: v === 0 ? 0 : v === 1 ? 4 : 50,
        lowStockThreshold: 5,
        weightGrams: 400,
      });
    }
    await db.insert(productVariants).values(variantRows);
    skuCounter++;
  }

  // ── Feed videos (10 posts, media_type = video) ───────────────────────
  const postRows = [];
  for (let i = 0; i < 10; i++) {
    postRows.push({
      userId: SELLER_CLERK_ID,
      mediaUrl: PLACEHOLDER_VIDEO,
      thumbnailUrl: PLACEHOLDER_IMG(`qa-video-${i + 1}`),
      mediaUrls: [PLACEHOLDER_VIDEO],
      mediaType: "video" as const,
      aspectRatio: "9:16",
      caption: `QA seed feed video #${i + 1} — new drop teaser.`,
      hashtags: ["qa", "newdrop"],
      styleTags: ["streetwear"],
      postStatus: "published" as const,
      publishedAt: new Date(Date.now() - i * 3600_000),
    });
  }
  await db.insert(posts).values(postRows);

  // ── Orders (one per distinct status) ─────────────────────────────────
  for (let i = 0; i < ORDER_STATUSES.length; i++) {
    const status = ORDER_STATUSES[i];
    const product = insertedProducts[i % insertedProducts.length];
    const [order] = await db
      .insert(orders)
      .values({
        ownerId: SELLER_CLERK_ID,
        buyerId: BUYER_CLERK_ID,
        orderNumber: `QA-${1000 + i}`,
        status,
        totalCents: 6500,
        subtotalCents: 6000,
        shippingCents: 500,
        taxCents: 0,
        grossChargedCents: status === "cancelled" ? 0 : 6500,
        paidAt: status === "pending" ? null : new Date(),
        shippingAddress: {
          name: "Jamie Buyer",
          street: "123 QA Test St",
          city: "Portland",
          state: "OR",
          zip: "97201",
          country: "US",
        },
        trackingStatus:
          status === "shipped" ? "in_transit" : status === "delivered" ? "delivered" : null,
        shippedAt: ["shipped", "delivered"].includes(status) ? new Date() : null,
        packedAt: ["fulfilled", "shipped", "delivered"].includes(status) ? new Date() : null,
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: order.id,
      productName: product.name,
      variantLabel: "M / Black",
      quantity: 1,
      priceCents: 6000,
    });
  }

  // ── Conversation (buyer <-> seller) ───────────────────────────────────
  const [conversation] = await db
    .insert(conversations)
    .values({
      type: "buyer_to_seller",
      lastMessage: "Thanks, looking forward to it!",
      lastMessageAt: new Date(),
      contextSellerName: "Riverside Studio",
    })
    .returning();
  await db.insert(conversationParticipants).values([
    {
      conversationId: conversation.id,
      userId: BUYER_CLERK_ID,
      name: "Jamie Buyer",
      handle: "qa_jamie_buyer",
      initials: "JB",
      accountType: "buyer",
      unreadCount: 0,
    },
    {
      conversationId: conversation.id,
      userId: SELLER_CLERK_ID,
      name: "Riverside Studio",
      handle: "qa_riverside_studio",
      initials: "RS",
      accountType: "seller",
      unreadCount: 1,
    },
  ]);
  await db.insert(messages).values([
    {
      conversationId: conversation.id,
      senderId: BUYER_CLERK_ID,
      senderName: "Jamie Buyer",
      body: "Hi! Does the crewneck run true to size?",
    },
    {
      conversationId: conversation.id,
      senderId: SELLER_CLERK_ID,
      senderName: "Riverside Studio",
      body: "Yes, true to size — most folks size up for an oversized fit.",
    },
    {
      conversationId: conversation.id,
      senderId: BUYER_CLERK_ID,
      senderName: "Jamie Buyer",
      body: "Thanks, looking forward to it!",
    },
  ]);

  // ── Follow (buyer follows seller) ─────────────────────────────────────
  await db.insert(follows).values({
    followerId: BUYER_CLERK_ID,
    followingId: SELLER_CLERK_ID,
  });

  // ── Notifications ──────────────────────────────────────────────────────
  await db.insert(notificationsFeed).values([
    {
      userId: BUYER_CLERK_ID,
      category: "order",
      type: "order_shipped",
      title: "Your order shipped",
      body: "QA-1004 is on its way.",
      actorName: "Riverside Studio",
    },
    {
      userId: BUYER_CLERK_ID,
      category: "social",
      type: "new_product",
      title: "Riverside Studio just added a new product",
      body: "Check out the Coach Jacket.",
      actorName: "Riverside Studio",
      targetId: insertedProducts[insertedProducts.length - 1].id,
      targetType: "product",
    },
    {
      userId: SELLER_CLERK_ID,
      category: "order",
      type: "new_order_received",
      title: "New order received",
      body: "Order QA-1000 was just placed.",
      actorName: "Jamie Buyer",
    },
    {
      userId: SELLER_CLERK_ID,
      category: "system",
      type: "low_stock",
      title: "Low stock alert",
      body: `${insertedProducts[0].name} is running low.`,
      targetId: insertedProducts[0].id,
      targetType: "product",
    },
  ]);

  // ── Thread Cash balance for the buyer ─────────────────────────────────
  await db.insert(threadCashEntries).values([
    { buyerId: BUYER_CLERK_ID, amountCents: 1000, source: "daily_checkin", note: "QA seed" },
    { buyerId: BUYER_CLERK_ID, amountCents: 500, source: "streak_bonus", note: "QA seed" },
    { buyerId: BUYER_CLERK_ID, amountCents: -300, source: "checkout_spend", note: "QA seed" },
  ]);
  await db.insert(threadCashStreaks).values({
    buyerId: BUYER_CLERK_ID,
    currentStreak: 3,
    longestStreak: 5,
    lastCheckInDate: new Date().toISOString().slice(0, 10),
    lastCheckInAt: new Date(),
  });

  console.log("Seed complete:");
  console.log(`  buyer  clerkId=${buyer.clerkId} id=${buyer.id}`);
  console.log(`  seller clerkId=${seller.clerkId} id=${seller.id}`);
  console.log(`  ${insertedProducts.length} products, 10 feed videos, ${ORDER_STATUSES.length} orders`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

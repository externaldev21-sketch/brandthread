/**
 * sellerSnapshot.ts
 *
 * Builds a permission-scoped, fresh account snapshot for the AI model.
 * All data is derived exclusively from the verified seller's own records —
 * no client-provided IDs or metrics are trusted.
 *
 * Values that are unavailable or untracked are represented as null,
 * never as invented numbers.
 */

import {
  db,
  products,
  productVariants,
  orders,
  orderItems,
  posts,
  storefronts,
  customers,
  conversations,
  conversationParticipants,
  boosts,
  sellerQuoteRequests,
  manufacturers,
  users,
  drops,
  discountCodes,
} from "@workspace/db";
import { eq, and, desc, asc, inArray, sql, gte, count, sum, isNull } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SellerSnapshot {
  snapshotAt: string;          // ISO timestamp — freshness signal for the model
  seller: SellerIdentity | null;
  storefront: StorefrontInfo | null;
  products: ProductSummary;
  inventory: InventorySummary;
  orders: OrderSummary;
  revenue: RevenueSummary;
  content: ContentSummary;
  customers: CustomerSummary;
  conversations: ConversationSummary;
  boosts: BoostSummary;
  manufacturerOrders: ManufacturerOrderSummary;
  discountCodes: DiscountCodeSummary;
}

export interface SellerIdentity {
  brandName: string | null;
  brandType: string | null;
  brandStage: string | null;
  onboardingComplete: boolean;
  stripeAccountStatus: string | null;  // payout readiness: 'active' | 'pending' | 'restricted' | null
}

export interface StorefrontInfo {
  title: string;
  subtitle: string | null;
  status: string;               // 'draft' | 'published'
  publishedAt: string | null;   // ISO or null
  slug: string;
}

export interface ProductSummary {
  totalActive: number;
  totalDraft: number;
  recent: RecentProduct[];      // newest 5 active/draft products
}

export interface RecentProduct {
  name: string;
  status: string;
  category: string;
  minPriceCents: number | null;
  variantCount: number;
  totalStock: number;
}

export interface InventorySummary {
  totalVariants: number;
  outOfStock: number;            // stock === 0
  lowStock: number;              // 0 < stock <= lowStockThreshold
  lowStockItems: LowStockItem[]; // top 5 most urgent
}

export interface LowStockItem {
  productName: string;
  variantLabel: string | null;  // e.g. "M / Black"
  stock: number;
  threshold: number;
}

export interface OrderSummary {
  recentOrders: RecentOrder[];  // last 10
  pendingCount: number;
  processingCount: number;
  fulfilledCount: number;
  cancelledCount: number;
  oldestUnfulfilledHoursAgo: number | null;
}

export interface RecentOrder {
  orderNumber: string;
  status: string;
  paymentStatus: string | null; // 'paid' | 'unpaid' | null
  totalCents: number;
  itemCount: number | null;
  createdAt: string;
}

export interface RevenueSummary {
  // ONLY from successful paid orders (paidAt IS NOT NULL, status != cancelled)
  // Clearly labelled — these are gross revenue figures, not net.
  last30DaysGrossCents: number | null;
  last7DaysGrossCents: number | null;
  allTimeGrossCents: number | null;
  last30DaysOrderCount: number | null;
  currency: "USD";
  note: string;
}

export interface ContentSummary {
  publishedPosts: number;
  draftPosts: number;
  recentPublished: RecentPost[];  // last 5 published
  scheduledCount: number;
}

export interface RecentPost {
  mediaType: string;
  caption: string | null;        // first 120 chars only
  publishedAt: string | null;
  likeCount: number | null;      // null if untracked
  commentCount: number | null;   // null if untracked
}

export interface CustomerSummary {
  totalCustomers: number;
  // Aggregate only — no names, emails, or addresses returned
  avgOrdersPerCustomer: number | null;
  avgSpentCents: number | null;
  topSpendBracket: string | null;  // e.g. "$100–$500"
}

export interface ConversationSummary {
  totalUnread: number;
  activeConversationCount: number;
  recentConversations: RecentConversation[];  // last 5
}

export interface RecentConversation {
  type: string;
  unreadCount: number;
  lastMessageAt: string | null;
  hasOrderContext: boolean;
}

export interface BoostSummary {
  activeBoosts: number | null;
  totalBudgetCents: number | null;
  totalSpentCents: number | null;
  available: boolean;
}

export interface ManufacturerOrderSummary {
  pendingQuotes: number | null;
  activeRelationships: number | null;
  recentRequests: RecentQuoteRequest[];
  available: boolean;
}

export interface RecentQuoteRequest {
  productName: string;
  type: string;
  status: string;
  createdAt: string;
}

export interface DiscountCodeSummary {
  activeCodes: number;
  totalCodes: number;
}

// ─── Snapshot builder ──────────────────────────────────────────────────────────

export async function buildSellerSnapshot(ownerId: string): Promise<SellerSnapshot> {
  const now = new Date();
  const snapshotAt = now.toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);

  // Run all independent queries in parallel — fail gracefully per section
  const [
    userResult,
    storefrontResult,
    productCountResult,
    recentProductsResult,
    variantStatsResult,
    lowStockResult,
    recentOrdersResult,
    orderStatusCountsResult,
    revenueAllTimeResult,
    revenue30dResult,
    revenue7dResult,
    postCountsResult,
    recentPostsResult,
    customerCountResult,
    customerAggResult,
    convSummaryResult,
    boostResult,
    quoteResult,
    discountCodeResult,
  ] = await Promise.allSettled([
    // [0] seller identity
    db.select({
      brandName: users.brandName,
      brandType: users.brandType,
      brandStage: users.brandStage,
      onboardingComplete: users.onboardingComplete,
      stripeAccountStatus: users.stripeAccountStatus,
    }).from(users).where(eq(users.clerkId, ownerId)).limit(1),

    // [1] storefront
    db.select({
      title: storefronts.title,
      subtitle: storefronts.subtitle,
      status: storefronts.status,
      publishedAt: storefronts.publishedAt,
      slug: storefronts.slug,
    }).from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1),

    // [2] product active/draft counts
    db.select({
      status: products.status,
      cnt: count(),
    }).from(products)
      .where(and(
        eq(products.ownerId, ownerId),
        isNull(products.deletedAt),
        inArray(products.status, ["active", "draft"]),
      ))
      .groupBy(products.status),

    // [3] recent products with variant aggregates
    db.select({
      name: products.name,
      status: products.status,
      category: products.category,
      minPriceCents: sql<number | null>`min(${productVariants.priceCents})`,
      variantCount: sql<number>`count(${productVariants.id})`,
      totalStock: sql<number>`coalesce(sum(${productVariants.stock}), 0)`,
    }).from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(
        eq(products.ownerId, ownerId),
        isNull(products.deletedAt),
        inArray(products.status, ["active", "draft"]),
      ))
      .groupBy(products.id, products.name, products.status, products.category)
      .orderBy(desc(products.createdAt))
      .limit(5),

    // [4] inventory variant stats (out-of-stock / low-stock counts)
    db.select({
      totalVariants: sql<number>`count(*)`,
      outOfStock: sql<number>`sum(case when ${productVariants.stock} = 0 then 1 else 0 end)`,
      lowStock: sql<number>`sum(case when ${productVariants.stock} > 0 and ${productVariants.stock} <= ${productVariants.lowStockThreshold} then 1 else 0 end)`,
    }).from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(
        eq(products.ownerId, ownerId),
        isNull(products.deletedAt),
      )),

    // [5] top 5 low-stock items
    db.select({
      productName: products.name,
      size: productVariants.size,
      color: productVariants.color,
      stock: productVariants.stock,
      threshold: productVariants.lowStockThreshold,
    }).from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(
        eq(products.ownerId, ownerId),
        isNull(products.deletedAt),
        sql`${productVariants.stock} <= ${productVariants.lowStockThreshold}`,
      ))
      .orderBy(asc(productVariants.stock))
      .limit(5),

    // [6] recent 10 orders (seller's own orders only)
    db.select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      paidAt: orders.paidAt,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
    }).from(orders)
      .where(eq(orders.ownerId, ownerId))
      .orderBy(desc(orders.createdAt))
      .limit(10),

    // [7] order status counts
    db.select({
      status: orders.status,
      cnt: count(),
    }).from(orders)
      .where(eq(orders.ownerId, ownerId))
      .groupBy(orders.status),

    // [8] all-time gross revenue (paid only, not cancelled)
    db.select({
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      orderCount: count(),
    }).from(orders)
      .where(and(
        eq(orders.ownerId, ownerId),
        sql`${orders.paidAt} is not null`,
        sql`${orders.status} != 'cancelled'`,
      )),

    // [9] last 30 days gross revenue
    db.select({
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      orderCount: count(),
    }).from(orders)
      .where(and(
        eq(orders.ownerId, ownerId),
        sql`${orders.paidAt} is not null`,
        sql`${orders.status} != 'cancelled'`,
        gte(orders.paidAt, thirtyDaysAgo),
      )),

    // [10] last 7 days gross revenue
    db.select({
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
    }).from(orders)
      .where(and(
        eq(orders.ownerId, ownerId),
        sql`${orders.paidAt} is not null`,
        sql`${orders.status} != 'cancelled'`,
        gte(orders.paidAt, sevenDaysAgo),
      )),

    // [11] post counts by status
    db.select({
      postStatus: posts.postStatus,
      cnt: count(),
    }).from(posts)
      .where(and(
        eq(posts.userId, ownerId),
        inArray(posts.postStatus, ["published", "draft", "scheduled"]),
      ))
      .groupBy(posts.postStatus),

    // [12] recent 5 published posts
    db.select({
      mediaType: posts.mediaType,
      caption: posts.caption,
      publishedAt: posts.publishedAt,
    }).from(posts)
      .where(and(
        eq(posts.userId, ownerId),
        eq(posts.postStatus, "published"),
      ))
      .orderBy(desc(posts.publishedAt))
      .limit(5),

    // [13] customer count (seller's own customers)
    db.select({ cnt: count() }).from(customers)
      .where(eq(customers.ownerId, ownerId)),

    // [14] customer aggregate stats (no PII)
    db.select({
      avgOrders: sql<number>`avg(${customers.orderCount})`,
      avgSpent: sql<number>`avg(${customers.totalSpentCents})`,
    }).from(customers)
      .where(eq(customers.ownerId, ownerId)),

    // [15] conversation summary — only conversations where this seller participates
    db.select({
      conversationId: conversationParticipants.conversationId,
      unreadCount: conversationParticipants.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      type: conversations.type,
      contextOrderId: conversations.contextOrderId,
    }).from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .where(and(
        eq(conversationParticipants.userId, ownerId),
        isNull(conversations.deletedAt),
      ))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(5),

    // [16] boosts (seller's own)
    db.select({
      status: boosts.status,
      budgetCents: boosts.budgetCents,
      spentCents: boosts.spentCents,
    }).from(boosts)
      .where(and(
        eq(boosts.sellerId, ownerId),
        eq(boosts.status, "active"),
      ))
      .limit(10),

    // [17] quote requests (seller's own)
    db.select({
      productName: sellerQuoteRequests.productName,
      type: sellerQuoteRequests.type,
      status: sellerQuoteRequests.status,
      createdAt: sellerQuoteRequests.createdAt,
    }).from(sellerQuoteRequests)
      .where(eq(sellerQuoteRequests.sellerId, ownerId))
      .orderBy(desc(sellerQuoteRequests.createdAt))
      .limit(5),

    // [18] discount codes
    db.select({
      active: discountCodes.active,
      cnt: count(),
    }).from(discountCodes)
      .where(eq(discountCodes.sellerId, ownerId))
      .groupBy(discountCodes.active),
  ]);

  // ─── Assemble sections ────────────────────────────────────────────────────

  // Seller identity
  const userRow = userResult.status === "fulfilled" ? userResult.value[0] : null;
  const seller: SellerIdentity | null = userRow
    ? {
        brandName: userRow.brandName ?? null,
        brandType: userRow.brandType ?? null,
        brandStage: userRow.brandStage ?? null,
        onboardingComplete: userRow.onboardingComplete,
        stripeAccountStatus: userRow.stripeAccountStatus ?? null,
      }
    : null;

  // Storefront
  const sfRow = storefrontResult.status === "fulfilled" ? storefrontResult.value[0] : null;
  const storefront: StorefrontInfo | null = sfRow
    ? {
        title: sfRow.title,
        subtitle: sfRow.subtitle ?? null,
        status: sfRow.status,
        publishedAt: sfRow.publishedAt?.toISOString() ?? null,
        slug: sfRow.slug,
      }
    : null;

  // Products
  const productCounts = productCountResult.status === "fulfilled" ? productCountResult.value : [];
  const totalActive = productCounts.find(r => r.status === "active")?.cnt ?? 0;
  const totalDraft  = productCounts.find(r => r.status === "draft")?.cnt ?? 0;
  const recentProductRows = recentProductsResult.status === "fulfilled" ? recentProductsResult.value : [];
  const recentProducts: RecentProduct[] = recentProductRows.map(r => ({
    name: r.name,
    status: r.status,
    category: r.category,
    minPriceCents: r.minPriceCents ?? null,
    variantCount: Number(r.variantCount),
    totalStock: Number(r.totalStock),
  }));

  // Inventory
  const variantStatsRow = variantStatsResult.status === "fulfilled" ? variantStatsResult.value[0] : null;
  const lowStockRows = lowStockResult.status === "fulfilled" ? lowStockResult.value : [];
  const inventorySummary: InventorySummary = {
    totalVariants: variantStatsRow ? Number(variantStatsRow.totalVariants) : 0,
    outOfStock: variantStatsRow ? Number(variantStatsRow.outOfStock ?? 0) : 0,
    lowStock: variantStatsRow ? Number(variantStatsRow.lowStock ?? 0) : 0,
    lowStockItems: lowStockRows.map(r => ({
      productName: r.productName,
      variantLabel: [r.size, r.color].filter(Boolean).join(" / ") || null,
      stock: r.stock,
      threshold: r.threshold,
    })),
  };

  // Orders
  const recentOrderRows = recentOrdersResult.status === "fulfilled" ? recentOrdersResult.value : [];
  const statusCounts = orderStatusCountsResult.status === "fulfilled" ? orderStatusCountsResult.value : [];
  const pendingOrProcessingDates = recentOrderRows
    .filter(r => r.status === "pending" || r.status === "processing")
    .map(r => new Date(r.createdAt).getTime());
  const oldestUnfulfilled = pendingOrProcessingDates.length > 0
    ? Math.floor((now.getTime() - Math.min(...pendingOrProcessingDates)) / (1000 * 60 * 60))
    : null;

  const orderSummary: OrderSummary = {
    recentOrders: recentOrderRows.map(r => ({
      orderNumber: r.orderNumber,
      status: r.status,
      paymentStatus: r.paidAt ? "paid" : "unpaid",
      totalCents: r.totalCents,
      itemCount: null,  // not fetched to keep query cost low
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    pendingCount:    statusCounts.find(r => r.status === "pending")?.cnt ?? 0,
    processingCount: statusCounts.find(r => r.status === "processing")?.cnt ?? 0,
    fulfilledCount:  (statusCounts.find(r => r.status === "fulfilled")?.cnt ?? 0) +
                     (statusCounts.find(r => r.status === "shipped")?.cnt ?? 0),
    cancelledCount:  statusCounts.find(r => r.status === "cancelled")?.cnt ?? 0,
    oldestUnfulfilledHoursAgo: oldestUnfulfilled,
  };

  // Revenue (paid successful commerce only)
  const allTimeRow = revenueAllTimeResult.status === "fulfilled" ? revenueAllTimeResult.value[0] : null;
  const rev30dRow  = revenue30dResult.status === "fulfilled" ? revenue30dResult.value[0] : null;
  const rev7dRow   = revenue7dResult.status === "fulfilled" ? revenue7dResult.value[0] : null;
  const revenueSummary: RevenueSummary = {
    allTimeGrossCents:     allTimeRow ? Number(allTimeRow.totalCents) : null,
    last30DaysGrossCents:  rev30dRow  ? Number(rev30dRow.totalCents) : null,
    last7DaysGrossCents:   rev7dRow   ? Number(rev7dRow.totalCents) : null,
    last30DaysOrderCount:  rev30dRow  ? Number(rev30dRow.orderCount) : null,
    currency: "USD",
    note: "Gross order totals from successfully paid, non-cancelled orders only. Does not account for refunds, platform fees, or shipping costs.",
  };

  // Content
  const postCountRows = postCountsResult.status === "fulfilled" ? postCountsResult.value : [];
  const recentPostRows = recentPostsResult.status === "fulfilled" ? recentPostsResult.value : [];
  const contentSummary: ContentSummary = {
    publishedPosts: postCountRows.find(r => r.postStatus === "published")?.cnt ?? 0,
    draftPosts:     postCountRows.find(r => r.postStatus === "draft")?.cnt ?? 0,
    scheduledCount: postCountRows.find(r => r.postStatus === "scheduled")?.cnt ?? 0,
    recentPublished: recentPostRows.map(r => ({
      mediaType: r.mediaType,
      caption: r.caption ? r.caption.slice(0, 120) : null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      likeCount: null,    // tracked separately via interactions aggregation — not included to keep snapshot lean
      commentCount: null, // same
    })),
  };

  // Customers (aggregates only — no PII)
  const customerCount = customerCountResult.status === "fulfilled" ? customerCountResult.value[0]?.cnt ?? 0 : 0;
  const custAgg = customerAggResult.status === "fulfilled" ? customerAggResult.value[0] : null;
  const avgSpent = custAgg?.avgSpent ? Number(custAgg.avgSpent) : null;
  const customerSummary: CustomerSummary = {
    totalCustomers: customerCount,
    avgOrdersPerCustomer: custAgg?.avgOrders ? Math.round(Number(custAgg.avgOrders) * 10) / 10 : null,
    avgSpentCents: avgSpent !== null ? Math.round(avgSpent) : null,
    topSpendBracket: avgSpent !== null ? spendBracket(avgSpent) : null,
  };

  // Conversations (seller participant only — no message content)
  const convRows = convSummaryResult.status === "fulfilled" ? convSummaryResult.value : [];
  const totalUnread = convRows.reduce((s, r) => s + (r.unreadCount ?? 0), 0);
  const convSummary: ConversationSummary = {
    totalUnread,
    activeConversationCount: convRows.length,
    recentConversations: convRows.map(r => ({
      type: r.type,
      unreadCount: r.unreadCount,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      hasOrderContext: !!r.contextOrderId,
    })),
  };

  // Boosts
  const boostRows = boostResult.status === "fulfilled" ? boostResult.value : null;
  const boostSummary: BoostSummary = boostRows !== null
    ? {
        activeBoosts: boostRows.length,
        totalBudgetCents: boostRows.reduce((s, r) => s + (r.budgetCents ?? 0), 0),
        totalSpentCents:  boostRows.reduce((s, r) => s + (r.spentCents ?? 0), 0),
        available: true,
      }
    : { activeBoosts: null, totalBudgetCents: null, totalSpentCents: null, available: false };

  // Manufacturer orders
  const quoteRows = quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const manfSummary: ManufacturerOrderSummary = quoteRows !== null
    ? {
        pendingQuotes: quoteRows.filter(r => r.status === "submitted").length,
        activeRelationships: null,  // not queried — keep snapshot lean
        recentRequests: quoteRows.map(r => ({
          productName: r.productName,
          type: r.type,
          status: r.status,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        available: true,
      }
    : { pendingQuotes: null, activeRelationships: null, recentRequests: [], available: false };

  // Discount codes
  const discountRows = discountCodeResult.status === "fulfilled" ? discountCodeResult.value : [];
  const activeCodes = discountRows.find(r => r.active === true)?.cnt ?? 0;
  const totalCodes  = discountRows.reduce((s, r) => s + (r.cnt ?? 0), 0);

  return {
    snapshotAt,
    seller,
    storefront,
    products: {
      totalActive: Number(totalActive),
      totalDraft: Number(totalDraft),
      recent: recentProducts,
    },
    inventory: inventorySummary,
    orders: orderSummary,
    revenue: revenueSummary,
    content: contentSummary,
    customers: customerSummary,
    conversations: convSummary,
    boosts: boostSummary,
    manufacturerOrders: manfSummary,
    discountCodes: { activeCodes: Number(activeCodes), totalCodes: Number(totalCodes) },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function spendBracket(cents: number): string {
  const dollars = cents / 100;
  if (dollars < 50)   return "under $50";
  if (dollars < 100)  return "$50–$100";
  if (dollars < 250)  return "$100–$250";
  if (dollars < 500)  return "$250–$500";
  if (dollars < 1000) return "$500–$1,000";
  return "over $1,000";
}

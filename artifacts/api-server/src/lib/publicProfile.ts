/**
 * Public-profile projections — the ONLY shape a non-owner may receive for a
 * profile. Everything here is an allow-list: a column added to `users`,
 * `products`, `product_variants` or `posts` later stays private until it is
 * deliberately added below.
 *
 * Owner-only data (plan / subscription, earnings, dashboard stats, policy
 * standing, orders, addresses, payment methods, Thread Cash, saved, cart,
 * notifications, contact details) lives behind owner-scoped, authenticated
 * routes (`/api/seller/*`, `/api/buyer/*`, `/api/thread-cash`, …) and must
 * never be spread into a public payload.
 */

/** Keys that must never appear anywhere in a profile payload served to a non-owner. */
export const PRIVATE_PROFILE_KEYS = [
  // plan / billing
  "subscriptionStatus", "subscriptionPlanId", "subscriptionPlan", "plan", "planId", "stripeCustomerId",
  "stripeAccountId", "trialEndsAt",
  // earnings / dashboard
  "earnings", "revenue", "revenueCents", "totalRevenueCents", "payouts", "balance", "dashboard", "insights",
  "storefrontVisits", "storefrontVisitCount",
  // seller standing / internal policy
  "activeStanding", "policyRestricted", "verificationStatus", "returnPolicy", "cancellationPolicy",
  // buyer private data
  "orders", "orderCount", "ordersCount", "totalSpentCents", "spend", "purchaseHistory",
  "addresses", "address", "paymentMethods", "threadCash", "threadCashBalance", "threadCashBalanceCents",
  "returns", "disputes", "saved", "savedItems", "wishlist", "cart", "notifications", "activity",
  "accounts", "linkedAccounts", "settings",
  // contact details
  "email", "phone", "phoneNumber", "contactEmail",
  // moderation / scheduling internals
  "moderationStatus", "coverVideoModerationStatus", "scheduledAt", "lowStockThreshold", "sku",
  "clerkSessionId", "stripeCheckoutSessionId",
] as const;

type Row = Record<string, any>;

/** Seller storefront header — what any viewer may see. */
export function toPublicSellerProfile(seller: Row): Row {
  return {
    clerkId: seller.clerkId,
    displayName: seller.displayName ?? null,
    brandName: seller.brandName ?? null,
    bio: seller.bio ?? null,
    website: seller.website ?? null,
    profileImageUrl: seller.profileImageUrl ?? null,
    avatarUrl: seller.avatarUrl ?? null,
    verified: seller.verified,
    brandType: seller.brandType ?? null,
    accountType: seller.accountType,
    username: seller.username ?? null,
  };
}

export function toPublicVariant(v: Row): Row {
  return {
    id: v.id,
    productId: v.productId,
    size: v.size ?? null,
    color: v.color ?? null,
    priceCents: v.priceCents,
    // Buyers need sold-out state; the exact restock threshold / SKU are the seller's.
    stock: v.stock,
    weightGrams: v.weightGrams,
  };
}

export function toPublicProduct(p: Row, variants: Row[]): Row {
  return {
    id: p.id,
    ownerId: p.ownerId,
    name: p.name,
    description: p.description ?? null,
    category: p.category,
    status: p.status,
    images: p.images ?? [],
    tags: p.tags ?? [],
    styleTags: p.styleTags ?? [],
    isPreOrder: p.isPreOrder,
    preOrderClosingDate: p.preOrderClosingDate ?? null,
    preOrderEstShipDate: p.preOrderEstShipDate ?? null,
    dropId: p.dropId ?? null,
    sizeChart: p.sizeChart ?? null,
    sizeChartImageUrl: p.sizeChartImageUrl ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    variants: variants.map(toPublicVariant),
  };
}

export function toPublicPost(p: Row, taggedProducts: Row[]): Row {
  return {
    id: p.id,
    userId: p.userId,
    mediaUrl: p.mediaUrl,
    thumbnailUrl: p.thumbnailUrl ?? null,
    mediaUrls: p.mediaUrls ?? [],
    mediaType: p.mediaType,
    aspectRatio: p.aspectRatio,
    caption: p.caption ?? null,
    hashtags: p.hashtags ?? [],
    styleTags: p.styleTags ?? [],
    sound: p.sound ?? null,
    visibility: p.visibility,
    postStatus: p.postStatus,
    createdAt: p.createdAt,
    taggedProducts,
  };
}

/**
 * A review as shown publicly. `orderId` (and the raw `buyer_id` join columns)
 * are dropped — exposing the order id would publish which purchase a buyer
 * made from whom. Reviewer name/avatar are the reviewer's own public identity.
 */
export function toPublicReview(r: Row): Row {
  return {
    id: r.id,
    buyerId: r.buyerId ?? r.buyer_id,
    sellerId: r.sellerId ?? r.seller_id,
    productId: r.productId ?? r.product_id ?? null,
    rating: r.rating,
    body: r.body ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
    ...(r.buyer_name !== undefined ? { buyer_name: r.buyer_name, buyer_avatar: r.buyer_avatar ?? null } : {}),
  };
}

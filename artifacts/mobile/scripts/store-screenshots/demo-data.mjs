/**
 * Polished demo data for store screenshots, served by a fake API that the
 * capture script installs in the browser. Nothing here touches a real
 * server, account or payment provider.
 *
 * Personas:
 *   - Seller: Maya Okafor, founder of Northline Studio (independent streetwear).
 *   - Buyer:  Jordan Reyes, shopping across Northline and three other labels.
 *
 * Money is integer cents everywhere (lib/money.ts throws on anything else).
 * Timestamps are relative to "now" so every relative label ("2h ago",
 * "Today") looks fresh whenever the screenshots are regenerated.
 */

export const IMAGE_HOST = 'https://cdn.brandthread.test';

// Mirrors content/legal.ts's LEGAL_VERSION. Duplicated (rather than imported)
// because this file runs under plain `node`, not a TS-aware runtime — kept
// in sync by tests/legal-documents-demo-data-sync.test.ts, which fails the
// suite the moment the two drift.
const DEMO_LEGAL_VERSION = '2026-09-23';
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

const HOUR = 36e5;
const DAY = 24 * HOUR;

/**
 * Every screenshot is taken at the same moment, Friday 18 September 2026 at
 * 4:30 pm in Los Angeles, so relative times, countdowns and the sales chart
 * are identical on every run. The capture script sets the browser clock and
 * time zone to match.
 */
export const DEMO_TIME_ZONE = 'America/Los_Angeles';
export const DEMO_NOW = Date.parse('2026-09-18T23:30:00Z');
const DEMO_LOCAL_MIDNIGHT = Date.parse('2026-09-18T07:00:00Z');
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const isoAhead = (msAhead) => new Date(DEMO_NOW + msAhead).toISOString();

export const SELLER_USER = {
  id: 'user_northline',
  firstName: 'Maya',
  lastName: 'Okafor',
  username: 'northlinestudio',
  email: 'maya@northlinestudio.co',
  imageUrl: img('portrait-rust'),
};

export const BUYER_USER = {
  id: 'user_jordan',
  firstName: 'Jordan',
  lastName: 'Reyes',
  username: 'jordanreyes',
  email: 'jordan@example.com',
  imageUrl: img('portrait-mono'),
};

// ─── Brands and catalogue ────────────────────────────────────────────────────

const BRANDS = {
  northline: { id: 'seller_northline', clerkId: SELLER_USER.id, name: 'Northline Studio', handle: 'northlinestudio', avatar: img('portrait-rust'), verified: true },
  ember: { id: 'seller_ember', clerkId: 'user_ember', name: 'Ember & Ash', handle: 'emberandash', avatar: img('texture-ember'), verified: true },
  field: { id: 'seller_field', clerkId: 'user_field', name: 'Field Office', handle: 'fieldoffice', avatar: img('look-mono') },
  quiet: { id: 'seller_quiet', clerkId: 'user_quiet', name: 'Quiet Hours', handle: 'quiethours', avatar: img('texture-mono') },
};

/** Public catalogue used by discover, the feed, the product sheet and the cart. */
export const CATALOGUE = [
  { id: 'prod_nl_hoodie_ember', brand: 'northline', name: 'Heavyweight Hoodie — Ember', image: 'hoodie-ember', priceCents: 9800, claimed: 212, remaining: 38, tag: 'Drop 04' },
  { id: 'prod_nl_jacket_rust', brand: 'northline', name: 'Field Shell Jacket — Rust', image: 'jacket-rust', priceCents: 22000, claimed: 64, remaining: 11, tag: 'Limited' },
  { id: 'prod_ea_hoodie_graphite', brand: 'ember', name: 'Boxy Fleece Hoodie — Graphite', image: 'hoodie-graphite', priceCents: 8800, claimed: 140, remaining: 60, tag: 'New' },
  { id: 'prod_fo_runner_rust', brand: 'field', name: 'Trail Runner 02 — Clay', image: 'runner-rust', priceCents: 16500, claimed: 91, remaining: 9, tag: 'Almost gone' },
  { id: 'prod_qh_hoodie_moss', brand: 'quiet', name: 'Garment-Dyed Hoodie — Moss', image: 'hoodie-moss', priceCents: 9200, claimed: 77, remaining: 43 },
  { id: 'prod_nl_cargo_rust', brand: 'northline', name: 'Utility Cargo Pant — Rust', image: 'cargo-rust', priceCents: 12800, claimed: 58, remaining: 22 },
  { id: 'prod_ea_jacket_onyx', brand: 'ember', name: 'Onyx Anorak', image: 'jacket-onyx', priceCents: 19800, claimed: 33, remaining: 17, tag: 'Pre-order' },
  { id: 'prod_qh_hoodie_midnight', brand: 'quiet', name: 'Loopback Hoodie — Midnight', image: 'hoodie-midnight', priceCents: 9400, claimed: 120, remaining: 30 },
  { id: 'prod_fo_runner_stone', brand: 'field', name: 'Trail Runner 02 — Stone', image: 'runner-stone', priceCents: 16500, claimed: 45, remaining: 55 },
  { id: 'prod_nl_hoodie_bone', brand: 'northline', name: 'Heavyweight Hoodie — Bone', image: 'hoodie-bone', priceCents: 9800, claimed: 188, remaining: 12 },
];

function publicProduct(item, index = 0) {
  const brand = BRANDS[item.brand];
  const sizes = ['S', 'M', 'L', 'XL'];
  return {
    id: item.id,
    name: item.name,
    description: `${item.name} from ${brand.name}. Cut and sewn in small batches from heavyweight, garment-washed cotton for a broken-in feel from day one.`,
    images: [img(item.image)],
    imageUrl: img(item.image),
    tags: item.tag ? [item.tag] : [],
    category: item.name.includes('Runner') ? 'Footwear' : item.name.includes('Pant') ? 'Pants' : item.name.includes('Jacket') || item.name.includes('Anorak') ? 'Outerwear' : 'Hoodies',
    sellerId: brand.clerkId,
    sellerProfileId: brand.id,
    sellerDisplayName: brand.name,
    sellerHandle: brand.handle,
    sellerAvatarUrl: brand.avatar,
    sellerVerified: brand.verified === true,
    priceCents: item.priceCents,
    currentPriceCents: item.priceCents,
    currency: 'usd',
    claimedUnits: item.claimed,
    remainingUnits: item.remaining,
    demandCount: item.claimed + 40,
    endsAt: isoAhead((index + 1) * 9 * HOUR),
    inStock: true,
    status: 'active',
    variants: sizes.map((size, i) => ({
      id: `${item.id}_${size.toLowerCase()}`,
      productId: item.id,
      title: size,
      size,
      name: size,
      priceCents: item.priceCents,
      inventoryQuantity: 12 - i * 2,
      stock: 12 - i * 2,
      available: true,
    })),
    createdAt: iso((index + 1) * DAY),
  };
}

export const PUBLIC_PRODUCTS = CATALOGUE.map(publicProduct);

const DROPS = [
  { id: 'drop_nl_04', brand: 'northline', name: 'Drop 04 — Ember Season', live: true, releaseIn: -2 * HOUR, endsIn: 30 * HOUR, products: ['prod_nl_hoodie_ember', 'prod_nl_jacket_rust'] },
  { id: 'drop_fo_runner', brand: 'field', name: 'Trail Runner 02 Restock', live: false, releaseIn: 20 * HOUR, endsIn: 72 * HOUR, products: ['prod_fo_runner_rust'] },
  { id: 'drop_qh_loopback', brand: 'quiet', name: 'Loopback Capsule', live: false, releaseIn: 3 * DAY, endsIn: 6 * DAY, products: ['prod_qh_hoodie_midnight'] },
  { id: 'drop_ea_onyx', brand: 'ember', name: 'Onyx Outerwear', live: false, releaseIn: 5 * DAY, endsIn: 9 * DAY, products: ['prod_ea_jacket_onyx'] },
];

function publicDrop(drop) {
  const brand = BRANDS[drop.brand];
  const products = drop.products.map((id) => PUBLIC_PRODUCTS.find((p) => p.id === id));
  return {
    id: drop.id,
    name: drop.name,
    isLive: drop.live,
    isEnded: false,
    releaseAt: isoAhead(drop.releaseIn),
    endsAt: isoAhead(drop.endsIn),
    currentPriceCents: products[0].priceCents,
    claimedUnits: products[0].claimedUnits,
    remainingUnits: products[0].remainingUnits,
    demandCount: products[0].demandCount,
    seller: { id: brand.id, brandName: brand.name, displayName: brand.name, avatarUrl: brand.avatar },
    products,
  };
}

const TRENDING = [
  // No `imageUri` here on purpose — the real /api/public/trending contract
  // has no image field today (metadata only), so this fixture matches that
  // real gap rather than papering over it; Discover's grid falls back to a
  // monochrome initials+caption tile for these. The first row does carry a
  // productTags array so the Discover viewer's "Shop the look" pill (which
  // only ever shows for a post with a real seller product tag) has one real
  // example to open in a screenshot — a forward-compatible field our own
  // client mapping (lib/discoverFeed.ts) reads defensively, not something
  // the real endpoint sends yet.
  //
  // Extended past the original 6 to 24 entries (same shape, no new fields)
  // so the For You grid has enough tiles to reach the rails gated deep into
  // it (Just Dropped / High Demand / Shop the Look each require a growing
  // `rows.length` threshold) — a real feed has far more posts than this
  // fixture; this is a test-fixture-scale fix, not a product change.
  { brand: 'northline', caption: 'Drop 04 is live. Ember hoodies restocked in every size.', mediaType: 'photo', likesCount: 4210, commentsCount: 96, verified: true, productTags: [{ productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', priceCents: 9800 }] },
  { brand: 'field', caption: 'Trail Runner 02 — built for city miles and weekend trails.', mediaType: 'photo', likesCount: 3180, commentsCount: 54, verified: true },
  { brand: 'quiet', caption: 'Moss, midnight and bone. The loopback capsule lands Friday.', mediaType: 'video', likesCount: 2870, commentsCount: 41 },
  { brand: 'ember', caption: 'Behind the seams: how we cut the Onyx anorak.', mediaType: 'video', likesCount: 2340, commentsCount: 38, verified: true, productTags: [{ productId: 'prod_em_anorak_onyx', productName: 'Onyx Anorak', priceCents: 24500 }] },
  { brand: 'northline', caption: 'Studio day. Sampling the FW26 cargo in rust.', mediaType: 'photo', likesCount: 1920, commentsCount: 22 },
  { brand: 'field', caption: 'Clay or stone? Vote for the next colourway.', mediaType: 'photo', likesCount: 1440, commentsCount: 65 },
  { brand: 'quiet', caption: 'Loopback capsule, restocked in bone.', mediaType: 'photo', likesCount: 1310, commentsCount: 19 },
  { brand: 'ember', caption: 'Onyx anorak, now in three colourways.', mediaType: 'photo', likesCount: 1275, commentsCount: 27, productTags: [{ productId: 'prod_em_anorak_onyx', productName: 'Onyx Anorak', priceCents: 24500 }] },
  { brand: 'northline', caption: 'Ember hoodie restock — almost sold out again.', mediaType: 'photo', likesCount: 1180, commentsCount: 31, verified: true },
  { brand: 'field', caption: 'Trail Runner 02, city-tested for six weeks.', mediaType: 'video', likesCount: 1102, commentsCount: 18 },
  { brand: 'quiet', caption: 'Midnight capsule, first look.', mediaType: 'photo', likesCount: 1044, commentsCount: 14 },
  { brand: 'ember', caption: 'Cutting room: the Onyx anorak pattern.', mediaType: 'photo', likesCount: 998, commentsCount: 22, verified: true },
  { brand: 'northline', caption: 'FW26 cargo, rust colourway restocked.', mediaType: 'photo', likesCount: 940, commentsCount: 16 },
  { brand: 'field', caption: 'Weekend trails, city miles. One shoe.', mediaType: 'photo', likesCount: 905, commentsCount: 12, verified: true },
  { brand: 'quiet', caption: 'Bone, moss, midnight — pick your capsule.', mediaType: 'video', likesCount: 870, commentsCount: 20 },
  { brand: 'ember', caption: 'Studio fit check: Onyx anorak layered.', mediaType: 'photo', likesCount: 820, commentsCount: 9 },
  { brand: 'northline', caption: 'Heavyweight hoodie, ember colourway restock.', mediaType: 'photo', likesCount: 795, commentsCount: 11, productTags: [{ productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', priceCents: 9800 }] },
  { brand: 'field', caption: 'Trail Runner 02 colourway poll results.', mediaType: 'photo', likesCount: 760, commentsCount: 8 },
  { brand: 'quiet', caption: 'Loopback capsule, styled three ways.', mediaType: 'photo', likesCount: 712, commentsCount: 13, verified: true },
  { brand: 'ember', caption: 'Onyx anorak, behind the seams part two.', mediaType: 'video', likesCount: 688, commentsCount: 10 },
  { brand: 'northline', caption: 'Studio day, FW26 preview continues.', mediaType: 'photo', likesCount: 654, commentsCount: 7 },
  { brand: 'field', caption: 'City miles, weekend trails — same shoe.', mediaType: 'photo', likesCount: 610, commentsCount: 9, verified: true },
  { brand: 'quiet', caption: 'Midnight capsule, restocked Friday.', mediaType: 'photo', likesCount: 588, commentsCount: 6 },
  { brand: 'ember', caption: 'Onyx anorak, now shipping worldwide.', mediaType: 'photo', likesCount: 542, commentsCount: 5 },
].map((row, i) => ({
  id: `post_trending_${i + 1}`, rank: i + 1, brand: BRANDS[row.brand].name, brandId: BRANDS[row.brand].id,
  caption: row.caption, mediaType: row.mediaType,
  likesCount: row.likesCount, commentsCount: row.commentsCount, verified: !!row.verified,
  productTags: row.productTags,
}));

// ─── Buyer Search screen (search / suggested / categories / people) ───────────

const BRAND_COLORS = ['#8B5CF6', '#0891B2', '#0F766E', '#B45309'];
const brandInitials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function publicSearch(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  const matches = (...fields) => !q || fields.some((f) => f?.toLowerCase().includes(q));

  const brandResults = Object.values(BRANDS)
    .filter((b) => matches(b.name, b.handle))
    .map((b, i) => ({
      id: b.clerkId, kind: 'brand', name: b.name, handle: `@${b.handle}`,
      color: BRAND_COLORS[i % BRAND_COLORS.length], initials: brandInitials(b.name), sellerId: b.clerkId,
    }));

  const productResults = PUBLIC_PRODUCTS
    .filter((p) => matches(p.name, p.sellerDisplayName, p.category))
    .map((p, i) => ({
      id: p.id, kind: 'product', brand: p.sellerDisplayName, name: p.name,
      price: `$${Math.round(p.priceCents / 100)}`, priceCents: p.priceCents, category: p.category,
      imageUri: p.images[0], color: BRAND_COLORS[i % BRAND_COLORS.length], initials: brandInitials(p.sellerDisplayName),
      productId: p.id,
    }));

  const videoResults = FEED_POSTS
    .filter((post) => matches(post.caption, BRANDS[post.brand].name))
    .map((post, i) => {
      const brand = BRANDS[post.brand];
      return {
        id: `search_video_${i + 1}`, kind: 'video', postId: `search_video_${i + 1}`,
        caption: post.caption, thumbnailUrl: img(post.image), videoUrl: img(post.image),
        authorId: brand.clerkId, authorName: brand.name, authorHandle: `@${brand.handle}`,
        authorAvatarUrl: brand.avatar, color: BRAND_COLORS[i % BRAND_COLORS.length],
        initials: brandInitials(brand.name), likesCount: post.likes,
      };
    });

  const results = [...brandResults, ...productResults, ...videoResults];
  return { results, pagination: { limit: 30, offset: 0, returned: results.length, total: results.length, hasMore: false } };
}

function searchSuggested() {
  return {
    brands: Object.values(BRANDS).map((b, i) => ({
      id: b.clerkId, sellerId: b.clerkId, name: b.name, handle: `@${b.handle}`,
      color: BRAND_COLORS[i % BRAND_COLORS.length], initials: brandInitials(b.name),
      followerCount: 12400 - i * 2100,
    })),
    products: PUBLIC_PRODUCTS.slice(0, 6).map((p, i) => ({
      id: p.id, productId: p.id, name: p.name, brand: p.sellerDisplayName,
      category: p.category, imageUri: p.images[0], color: BRAND_COLORS[i % BRAND_COLORS.length],
      initials: brandInitials(p.sellerDisplayName),
    })),
  };
}

function searchCategories() {
  const seen = new Map();
  for (const p of PUBLIC_PRODUCTS) {
    if (!seen.has(p.category)) seen.set(p.category, p);
  }
  return {
    categories: [...seen.entries()].map(([category, p], i) => ({
      category, productCount: PUBLIC_PRODUCTS.filter((x) => x.category === category).length,
      imageUri: p.images[0], color: BRAND_COLORS[i % BRAND_COLORS.length],
    })),
  };
}

function searchPeople() {
  return [
    { userId: 'user_priya', name: 'Priya Nandan', username: 'priyan', handle: '@priyan', initials: 'PN', color: '#B45309', bio: 'Streetwear archive', isFollowing: false },
    { userId: 'user_theo', name: 'Theo Marsh', username: 'theomarsh', handle: '@theomarsh', initials: 'TM', color: '#0F766E', bio: 'Trail running, always', isFollowing: true },
  ];
}

// ─── Buyer data (Jordan Reyes) ────────────────────────────────────────────────

const FEED_POSTS = [
  { brand: 'northline', image: 'story-rust', caption: 'Drop 04 is live. Ember season, cut heavy and made to last.', products: ['prod_nl_jacket_rust', 'prod_nl_cargo_rust'], likes: 18400, comments: 612, reposts: 1290, hoursAgo: 2 },
  { brand: 'ember', image: 'story-hoodie', caption: 'Boxy fleece in graphite. 480gsm, brushed inside.', products: ['prod_ea_hoodie_graphite'], likes: 9360, comments: 204, reposts: 441, hoursAgo: 5 },
  { brand: 'field', image: 'runner-rust', caption: 'Trail Runner 02 — city miles, weekend trails.', products: ['prod_fo_runner_rust'], likes: 22100, comments: 731, reposts: 1640, hoursAgo: 9 },
  { brand: 'quiet', image: 'hoodie-moss', caption: 'Moss, midnight and bone. The loopback capsule lands Friday.', products: ['prod_qh_hoodie_moss', 'prod_qh_hoodie_midnight'], likes: 7020, comments: 188, reposts: 350, hoursAgo: 20 },
  { brand: 'northline', image: 'story-mono', caption: 'Studio day: sampling the FW26 shell in onyx.', products: ['prod_ea_jacket_onyx'], likes: 11800, comments: 276, reposts: 715, hoursAgo: 30 },
];

function feedPosts() {
  return FEED_POSTS.map((post, i) => {
    const brand = BRANDS[post.brand];
    return {
      id: `post_demo_${i + 1}`,
      userId: brand.clerkId,
      seller: { brandName: brand.name, displayName: brand.name, avatarUrl: brand.avatar },
      caption: post.caption,
      mediaType: 'photo',
      mediaUrls: [img(post.image)],
      mediaUrl: img(post.image),
      thumbnailUrl: img(post.image),
      taggedProducts: post.products.map((id) => {
        const product = PUBLIC_PRODUCTS.find((p) => p.id === id);
        return { productId: id, name: product.name, priceCents: product.priceCents };
      }),
      likesCount: post.likes,
      commentsCount: post.comments,
      repostsCount: post.reposts,
      createdAt: iso(post.hoursAgo * HOUR),
    };
  });
}

function cartItem(productId, size, lineId, extra = {}) {
  const product = PUBLIC_PRODUCTS.find((p) => p.id === productId);
  const brand = Object.values(BRANDS).find((b) => b.clerkId === product.sellerId);
  return {
    id: lineId,
    productId,
    variantId: `${productId}_${size.toLowerCase()}`,
    productName: product.name,
    variantTitle: size,
    imageUri: product.images[0],
    sellerId: brand.clerkId,
    sellerName: brand.name,
    sellerHandle: `@${brand.handle}`,
    priceCents: product.priceCents,
    quantity: 1,
    maxQuantity: 6,
    isPreOrder: false,
    inventoryPolicy: 'deny',
    isAvailable: true,
    addedAt: iso(3 * HOUR),
    ...extra,
  };
}

export const CART = {
  items: [
    cartItem('prod_nl_hoodie_ember', 'M', 'line_1'),
    cartItem('prod_nl_jacket_rust', 'L', 'line_2', { maxQuantity: 3 }),
    cartItem('prod_fo_runner_rust', '10', 'line_3', { compareAtPriceCents: 19500 }),
  ],
  savedItems: [{ ...cartItem('prod_qh_hoodie_moss', 'M', 'saved_1'), savedAt: iso(DAY) }],
};

/** A filled checkout ready for review, so the screen never calls Stripe. */
export function checkoutSession() {
  const groups = {};
  for (const item of CART.items) (groups[item.sellerId] ??= { sellerName: item.sellerName, items: [] }).items.push(item);
  const deliveryGroups = Object.entries(groups).map(([sellerId, group]) => ({
    sellerId,
    sellerName: group.sellerName,
    items: group.items,
    selectedMethodId: `seller_rate_${sellerId}`,
    availableMethods: [{ id: `seller_rate_${sellerId}`, carrier: 'Seller shipping', service: 'Express courier (2–3 days)', priceCents: 1200, estimatedDays: 3, estimatedDelivery: 'Arrives in 2–3 days', trackingIncluded: true, isRecommended: true }],
    hasPreOrder: false,
  }));
  const subtotalCents = CART.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const shippingTotalCents = deliveryGroups.length * 1200;
  return {
    id: 'checkout_demo',
    cartId: 'cart_demo',
    step: 'review',
    contact: { email: BUYER_USER.email, phone: '+1 (503) 555-0142', marketingConsent: false, orderUpdates: 'email' },
    shippingAddress: { firstName: 'Jordan', lastName: 'Reyes', line1: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142' },
    savedAddresses: [],
    deliveryGroups,
    discounts: [],
    summary: { subtotalCents, discountTotalCents: 0, shippingTotalCents, taxTotalCents: 0, totalCents: subtotalCents + shippingTotalCents, currency: 'USD' },
    acknowledgments: [{ key: 'terms', label: 'I agree to the Brandthread Terms of Service and Refund Policy.', required: true, acknowledged: true }],
    isBuyNow: false,
    idempotencyKey: 'checkout_demo_key',
    createdAt: iso(10 * 60e3),
    updatedAt: iso(5 * 60e3),
  };
}

const REVIEWS = {
  reviews: [
    { id: 'rev_1', rating: 5, body: 'Heaviest hoodie I own and it still drapes. Sized true.', createdAt: iso(6 * DAY) },
    { id: 'rev_2', rating: 5, body: 'The ember colour is even better in person.', createdAt: iso(14 * DAY) },
    { id: 'rev_3', rating: 4, body: 'Great fit, sleeves run slightly long.', createdAt: iso(30 * DAY) },
  ],
  avgRating: 4.8,
  totalCount: 126,
};

// ─── Seller data (Northline Studio) ───────────────────────────────────────────

function sellerProduct(id, name, category, priceCents, compareAtCents, stock, status, image, daysAgo, sales, sizes = ['S', 'M', 'L', 'XL']) {
  const createdAt = iso(daysAgo * DAY);
  return {
    id, sellerId: SELLER_USER.id, name, description: `${name} by Northline Studio.`, category, tags: ['streetwear', 'northline'],
    media: [{ id: `${id}_m1`, type: 'image', uri: img(image), isCover: true, sortOrder: 0, createdAt }],
    pricing: { priceCents, ...(compareAtCents ? { compareAtPriceCents: compareAtCents } : {}), costCents: Math.round(priceCents * 0.32), currency: 'USD' },
    options: [{ id: `${id}_o1`, type: 'size', name: 'Size', sortOrder: 0, values: sizes.map((s) => ({ id: `${id}_${s}`, value: s })) }],
    variants: sizes.map((s, i) => ({
      id: `${id}_v${i}`, productId: id, title: s, optionValues: [{ optionId: `${id}_o1`, valueId: `${id}_${s}` }],
      sku: `NL-${id.slice(-4).toUpperCase()}-${s}`, inventoryQuantity: Math.floor(stock / sizes.length), reservedQuantity: 0, incomingQuantity: 0,
      status: 'active', requiresShipping: true, taxable: true, createdAt, updatedAt: createdAt,
    })),
    inventory: { productId: id, trackQuantity: true, allowOverselling: false, policy: 'deny', lowStockThreshold: 10, totalStock: stock, availableStock: stock, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [] },
    salesModel: 'pre-made', fulfillment: { type: 'seller' }, manufacturing: { stage: 'none' },
    storeSettings: { status, collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } },
    totalSales: sales, totalRevenueCents: sales * priceCents, status, createdAt, updatedAt: iso(HOUR),
  };
}

export const SELLER_PRODUCTS = [
  sellerProduct('prod_nl_hoodie_ember', 'Heavyweight Hoodie — Ember', 'Hoodie', 9800, null, 142, 'active', 'hoodie-ember', 2, 318),
  sellerProduct('prod_nl_jacket_rust', 'Field Shell Jacket — Rust', 'Jacket', 22000, null, 36, 'active', 'jacket-rust', 5, 64),
  sellerProduct('prod_nl_hoodie_bone', 'Heavyweight Hoodie — Bone', 'Hoodie', 9800, 11800, 8, 'active', 'hoodie-bone', 9, 511),
  sellerProduct('prod_nl_cargo_rust', 'Utility Cargo Pant — Rust', 'Pants', 12800, null, 0, 'active', 'cargo-rust', 14, 97),
  sellerProduct('prod_nl_hoodie_graphite', 'Heavyweight Hoodie — Graphite', 'Hoodie', 9800, null, 77, 'active', 'hoodie-graphite', 20, 203),
  sellerProduct('prod_nl_jacket_onyx', 'Field Shell Jacket — Onyx', 'Jacket', 22000, null, 54, 'draft', 'jacket-onyx', 1, 0),
  sellerProduct('prod_nl_hoodie_moss', 'Heavyweight Hoodie — Moss', 'Hoodie', 9800, null, 60, 'draft', 'hoodie-moss', 3, 0),
  sellerProduct('prod_nl_runner', 'Studio Runner — Clay', 'Footwear', 16500, null, 12, 'archived', 'runner-rust', 60, 88, ['8', '9', '10', '11']),
];

/** `count` seller products for performance runs (cycles the demo catalogue). */
export function manySellerProducts(count) {
  return Array.from({ length: count }, (_, i) => {
    const base = SELLER_PRODUCTS[i % SELLER_PRODUCTS.length];
    const id = `${base.id}_${i}`;
    return { ...base, id, name: `${base.name} #${i + 1}`, createdAt: iso(i * HOUR), media: base.media.map((m) => ({ ...m, id: `${id}_m1` })) };
  });
}

function sellerOrders(count = 9) {
  const customers = ['Jordan Reyes', 'Amara Chen', 'Diego Santos', 'Priya Nair', 'Theo Walsh', 'Sofia Marquez', 'Kai Morgan', 'Lena Fischer', 'Omar Haddad'];
  const statuses = ['pending', 'pending', 'processing', 'fulfilled', 'shipped', 'shipped', 'processing', 'shipped', 'cancelled'];
  const drops = ['Drop 04 — Ember Season', 'Heavyweight Hoodie', 'Field Shell Jacket', 'Utility Cargo Pant'];
  const ages = [0.6, 2, 5, 20, 28, 52, 75, 100, 130];
  return Array.from({ length: count }, (_, i) => {
    const name = customers[i % customers.length];
    const status = statuses[i % statuses.length];
    const hoursAgo = i < ages.length ? ages[i] : ages[ages.length - 1] + (i - ages.length + 1) * 6;
    return {
      id: `ord_${1048 - i}`,
      orderNumber: `#NS-${1048 - i}`,
      status,
      totalCents: [14200, 9800, 26400, 22000, 9800, 16000, 12800, 22000, 9800][i % 9],
      customerName: name,
      customerEmail: `${name.split(' ')[0].toLowerCase()}@example.com`,
      itemCount: (i % 3) + 1,
      dropName: drops[i % drops.length],
      trackingNumber: status === 'shipped' ? `9400111899223817${450012 + i}` : null,
      carrier: status === 'shipped' ? 'USPS' : null,
      cancellationReason: status === 'cancelled' ? 'customer_request' : null,
      createdAt: iso(hoursAgo * HOUR),
      updatedAt: iso(Math.max(0.2, hoursAgo - 1) * HOUR),
    };
  });
}

// GET /api/orders/:id — the order-detail screen's full raw shape (order-
// detail.tsx's adaptApiOrder), built from the same sellerOrders() rows so
// the order number, customer and amount always match the list screen.
// The first row (the demo seller's real buyer, BUYER_USER) carries a real
// buyerId so the "Message Buyer" action (item 129) has someone to message;
// the rest are guest checkouts (buyerId: null), same as production data
// where not every order has a linked Brandthread account.
function sellerOrderDetail(id, count = 9) {
  const rows = sellerOrders(Math.max(count, 1));
  // Falls back to the first row for an id this fixture doesn't know about
  // (e.g. a caller navigating with a real-looking id like "so-1") instead
  // of 404ing — every other field below is keyed off the matched row, so
  // the response stays internally consistent either way.
  const row = rows.find((r) => r.id === id) ?? rows[0];
  const index = rows.indexOf(row);
  return {
    id: row.id,
    ownerId: 'user_northline',
    buyerId: index === 0 ? BUYER_USER.id : null,
    customerId: null,
    customer: null,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    guestEmail: index === 0 ? null : row.customerEmail,
    shippingAddress: {
      name: row.customerName,
      street: '129 Ember Court',
      city: 'Portland',
      state: 'OR',
      zip: '97205',
      country: 'US',
    },
    orderNumber: row.orderNumber,
    status: row.status,
    totalCents: row.totalCents,
    subtotalCents: Math.round(row.totalCents * 0.92),
    shippingCents: row.totalCents - Math.round(row.totalCents * 0.92),
    trackingNumber: row.trackingNumber,
    carrier: row.carrier,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: [{
      id: `${row.id}-item-1`,
      productId: CATALOGUE.find((c) => c.brand === 'northline')?.id ?? '',
      productName: row.dropName,
      variantLabel: 'M',
      quantity: row.itemCount,
      priceCents: Math.round(row.totalCents / row.itemCount),
    }],
  };
}

function homeAnalytics(range) {
  const midnight = new Date(DEMO_LOCAL_MIDNIGHT);
  const config = {
    today: [6, 4 * HOUR, midnight],
    yesterday: [6, 4 * HOUR, new Date(midnight - DAY)],
    week: [7, DAY, new Date(midnight - 6 * DAY)],
    live: [6, 10 * 60e3, new Date(DEMO_NOW - HOUR)],
  }[range] ?? [6, 4 * HOUR, midnight];
  const amounts = {
    today: [3400, 9800, 46800, 71200, 52400, 0], // 4:30 pm: the 8 pm bucket has not started
    yesterday: [6800, 31200, 52400, 70800, 64400, 38400],
    week: [182400, 241800, 156200, 298600, 211000, 334400, 249000],
    live: [9800, 6800, 22000, 14200, 9400, 19600],
  }[range] ?? [];
  const [, step, start] = config;
  const buckets = amounts.map((cents, i) => ({ bucket: new Date(+start + i * step).toISOString(), totalCents: cents, orderCount: Math.max(1, Math.round(cents / 9800)) }));
  return {
    range,
    totalCents: buckets.reduce((sum, b) => sum + b.totalCents, 0),
    orderCount: buckets.reduce((sum, b) => sum + b.orderCount, 0),
    visitorCount: { today: 1284, yesterday: 1519, week: 9876, live: 37 }[range] ?? 1284,
    toFulfill: 7,
    toCapture: 2,
    buckets,
  };
}

const MANUFACTURERS = [
  { id: 'a1c3e5f7-2b4d-4e6f-8a1b-3c5d7e9f1a2b', businessName: 'Porto Knit Collective', country: 'Portugal', city: 'Porto', description: 'Family-run cut & sew for premium fleece and heavyweight jersey.', photos: [img('hoodie-graphite')], yearsInBusiness: 22, specialty: 'Hoodies, Heavyweight Tees, Fleece', moq: 150, priceRange: '$14–$26', bulkTurnaround: '28 days', responseTime: '6 hours', rating: 4.9, reviewCount: 87, isVerified: true, website: 'https://portoknit.example', contactEmail: 'studio@portoknit.example', createdAt: iso(400 * DAY) },
  { id: 'b2d4f6a8-3c5e-4f7a-9b2c-4d6e8f0a2b3c', businessName: 'LA Garment Works', country: 'USA', city: 'Los Angeles', description: 'Domestic small-batch production with an on-site dye house.', photos: [img('hoodie-moss')], yearsInBusiness: 11, specialty: 'Garment Dye, Tees, Sweatpants', moq: 50, priceRange: '$11–$19', bulkTurnaround: '21 days', responseTime: '4 hours', rating: 4.7, reviewCount: 142, isVerified: true, createdAt: iso(300 * DAY) },
  { id: 'c3e5a7b9-4d6f-4a8b-8c3d-5e7f9a1b3c4d', businessName: 'Harbour Outerwear', country: 'Vietnam', city: 'Ho Chi Minh City', description: 'Technical shells and outerwear, full-package development.', photos: [img('jacket-onyx')], yearsInBusiness: 15, specialty: 'Outerwear, Shell Jackets, Embroidery', moq: 300, priceRange: '$18–$42', bulkTurnaround: '35 days', responseTime: '12 hours', rating: 4.6, reviewCount: 64, isVerified: true, createdAt: iso(500 * DAY) },
  { id: 'd4f6b8c0-5e7a-4b9c-9d4e-6f8a0b2c4d5e', businessName: 'Tiruppur Cotton Co.', country: 'India', city: 'Tiruppur', description: 'Organic cotton jersey, GOTS certified.', photos: [img('hoodie-bone')], yearsInBusiness: 9, specialty: 'Organic Tees, Knitwear', moq: 200, priceRange: '$6–$12', bulkTurnaround: '30 days', responseTime: '10 hours', rating: 4.8, reviewCount: 53, verifiedAt: iso(250 * DAY), createdAt: iso(600 * DAY) },
  { id: 'e5a7c9d1-6f8b-4cad-8e5f-7a9b1c3d5e6f', businessName: 'Oaxaca Leather Studio', country: 'Mexico', city: 'Oaxaca', description: 'Hand-finished leather goods and footwear uppers.', photos: [img('runner-rust')], yearsInBusiness: 18, specialty: 'Footwear, Leather Goods', moq: 100, priceRange: '$22–$48', bulkTurnaround: '40 days', responseTime: '8 hours', rating: 4.9, reviewCount: 38, isVerified: true, createdAt: iso(700 * DAY) },
];

const MANUFACTURER_THREADS = [
  { id: 'th-1', manufacturerId: MANUFACTURERS[0].id, manufacturerName: 'Porto Knit Collective', subject: 'FW26 Core Hoodie Run', lastMessage: 'Panels are cut — sending sewing line photos tomorrow.', lastMessageAt: iso(1.2 * HOUR), unreadCount: 2, createdAt: iso(30 * DAY) },
  { id: 'th-2', manufacturerId: MANUFACTURERS[2].id, manufacturerName: 'Harbour Outerwear', subject: 'Field Shell quote', lastMessage: 'Seam taping upgrade adds $1.80/unit.', lastMessageAt: iso(17 * HOUR), unreadCount: 1, createdAt: iso(14 * DAY) },
  { id: 'th-3', manufacturerId: MANUFACTURERS[1].id, manufacturerName: 'LA Garment Works', subject: 'Garment dye sample', lastMessage: 'Tracking uploaded — should land Thursday.', lastMessageAt: iso(2 * DAY), unreadCount: 0, createdAt: iso(8 * DAY) },
];

const SELLER_QUOTE_REQUESTS = [
  { id: 'qr-1', manufacturerId: MANUFACTURERS[2].id, productName: 'Field Shell Jacket — Onyx', status: 'quoted', type: 'bulk', quantity: 300, colorways: 'Onyx, Rust', quotedPriceCents: 1260000, quotedTurnaround: '35 days', quoteValidUntil: isoAhead(21 * DAY), notes: '30% deposit, balance before ship', createdAt: iso(14 * DAY), updatedAt: iso(3 * DAY) },
  { id: 'qr-2', manufacturerId: MANUFACTURERS[0].id, productName: 'Heavyweight Hoodie — Bone', status: 'quoted', type: 'bulk', quantity: 250, quotedPriceCents: 575000, quotedTurnaround: '28 days', quoteValidUntil: isoAhead(14 * DAY), createdAt: iso(12 * DAY), updatedAt: iso(5 * DAY) },
  { id: 'qr-3', manufacturerId: MANUFACTURERS[1].id, productName: 'Garment-Dyed Hoodie — Moss', status: 'submitted', type: 'bulk', quantity: 400, createdAt: iso(2 * DAY), updatedAt: iso(2 * DAY) },
];

const SAMPLE_ORDERS = [
  { id: 'so-1', manufacturerId: MANUFACTURERS[0].id, manufacturerName: 'Porto Knit Collective', title: 'Heavyweight Hoodie — Bone', status: 'delivered', orderType: 'sample', priceCents: 8500, quantity: 1, revision: 2, threadId: 'th-1', createdAt: iso(21 * DAY), updatedAt: iso(3 * DAY) },
  { id: 'so-2', manufacturerId: MANUFACTURERS[2].id, manufacturerName: 'Harbour Outerwear', title: 'Field Shell Proto', status: 'cut_and_sew', orderType: 'sample', priceCents: 14000, quantity: 1, revision: 1, createdAt: iso(10 * DAY), updatedAt: iso(2 * DAY) },
  { id: 'bo-1', manufacturerId: MANUFACTURERS[0].id, manufacturerName: 'Porto Knit Collective', title: 'FW26 Core Hoodie Run', status: 'cut_and_sew', orderType: 'bulk', priceCents: 1680000, quantity: 300, revision: 3, threadId: 'th-1', createdAt: iso(33 * DAY), updatedAt: iso(4 * DAY) },
  { id: 'bo-2', manufacturerId: MANUFACTURERS[1].id, manufacturerName: 'LA Garment Works', title: 'Moss Hoodie Restock', status: 'payment_received', orderType: 'bulk', priceCents: 468000, quantity: 400, revision: 1, createdAt: iso(7 * DAY), updatedAt: iso(6 * DAY) },
];

/**
 * The half-done audit synthesizes dynamic-route params generically (see
 * PARAM_VALUES in scripts/audit/half-done-audit.mjs) — e.g. every `:id`
 * route gets the same product id, every otherwise-unmapped param gets
 * 'sample-1'. None of those match a real seeded row here, so a strict
 * byId() lookup 404s on every one of these detail screens even though the
 * app itself already handles "not found" gracefully (EmptyState, no
 * crash) — the 404 status itself is what the browser logs as a hard-tier
 * console error, independent of the app's own try/catch. Falling back to
 * the first seeded row (rather than a literal not-found) keeps these
 * fixture-driven audit/screenshot runs deterministic and error-free
 * without the app's real "not found" behavior ever being exercised here.
 */
const firstOr = (list) => (id) => list.find((item) => item.id === decodeURIComponent(id)) ?? list[0] ?? null;

function productionTimelineFor(id) {
  const bulkOrders = SAMPLE_ORDERS.filter((o) => o.orderType === 'bulk');
  const order = bulkOrders.find((o) => o.id === decodeURIComponent(id)) ?? bulkOrders[0];
  const snapshot = {
    id: order.id, orderType: order.orderType, title: order.title, description: null,
    quantity: order.quantity, priceCents: order.priceCents, currency: 'usd', status: order.status,
    issuedBy: 'manufacturer', carrier: order.carrier ?? null, trackingNumber: order.trackingNumber ?? null,
    paymentReviewState: 'none', manufacturerPayoutReady: true, revision: order.revision, updatedAt: order.updatedAt,
  };
  const steps = ['quote_accepted', 'deposit_paid', 'materials_sourcing', 'sewing', 'packaging', 'shipped', 'delivered'].map((stage, i) => ({
    stage, label: stage.replace(/_/g, ' '), description: '', state: i === 0 ? 'done' : i === 1 ? 'current' : 'upcoming', at: i === 0 ? order.createdAt : null,
  }));
  return {
    viewerRole: 'seller', order: snapshot,
    manufacturer: { id: order.manufacturerId, businessName: order.manufacturerName, country: '', timeZone: null },
    steps, events: [], createdAt: order.createdAt, paidAt: null,
    tracking: { carrier: null, carrierName: null, trackingNumber: null, url: null },
  };
}

function sellerConversations(count = 5) {
  const people = [
    ['Jordan Reyes', '@jordanreyes', 'JR', '#5E5E66', 'Any chance the Ember hoodie ships before Friday?', 'buyer_to_seller_order', '#NS-1048', 'Heavyweight Hoodie — Ember'],
    ['Amara Chen', '@amarac', 'AC', '#46464D', 'How does the Field Shell fit? I’m usually a medium.', 'buyer_to_seller_product', null, 'Field Shell Jacket — Rust'],
    ['Diego Santos', '@dsantos', 'DS', '#3A3A40', 'Got it, thanks for the tracking!', 'buyer_to_seller', null, null],
    ['Priya Nair', '@priyan', 'PN', '#55555C', 'Can I swap the hoodie to Bone?', 'buyer_to_seller_order', '#NS-1045', null],
    ['Theo Walsh', '@theow', 'TW', '#4A4A50', 'Will the cargo come back in rust?', 'buyer_to_seller_product', null, 'Utility Cargo Pant — Rust'],
  ];
  const minutesAgo = [4, 38, 190, 1500, 2900];
  return Array.from({ length: count }, (_, i) => {
    const [name, handle, initials, color, message, type, orderNumber, productName] = people[i % people.length];
    const ts = DEMO_NOW - (minutesAgo[i] ?? 2900 + i * 90) * 60e3;
    return {
      id: `cv_${i + 1}`,
      type,
      participants: [
        { userId: `user_buyer_${i + 1}`, name, handle, initials, color, accountType: 'buyer' },
        { userId: SELLER_USER.id, name: 'Northline Studio', handle: '@northlinestudio', initials: 'NS', color: '#2B2B30', accountType: 'seller' },
      ],
      lastMessage: message,
      lastMessageTs: ts,
      unreadCount: i < 2 ? 2 - i : 0,
      ...(orderNumber ? { contextOrderNumber: orderNumber } : {}),
      ...(productName ? { contextProductName: productName } : {}),
      updatedAt: new Date(ts).toISOString(),
    };
  });
}

function profileFor(role) {
  const user = role === 'seller' ? SELLER_USER : BUYER_USER;
  return {
    // Keeps the demo account "already agreed" to the current terms so
    // LegalAcceptanceGate never blocks a capture — without this the gate
    // shows on every screen the moment content/legal.ts's LEGAL_VERSION is
    // bumped, since termsVersion was previously left unset here.
    termsVersion: DEMO_LEGAL_VERSION,
    id: role === 'seller' ? '8d1f6a2e-4b3c-4e5d-9f60-7a8b9c0d1e2f' : '9e2a7b3f-5c4d-4f6e-8a71-8b9c0d1e2f3a',
    clerkId: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`,
    displayName: role === 'seller' ? 'Northline Studio' : `${user.firstName} ${user.lastName}`,
    username: user.username,
    avatarUrl: user.imageUrl,
    bio: role === 'seller' ? 'Independent streetwear. Small-batch heavyweight basics.' : 'Heavyweight hoodies and trail runners.',
    accountType: role,
    brandName: role === 'seller' ? 'Northline Studio' : null,
    appThemeId: null,
    appIconId: null,
    onboardingComplete: true,
  };
}

// ─── Fake API ────────────────────────────────────────────────────────────────

/**
 * Returns the JSON body for a request, or undefined when nothing is seeded
 * (the capture script then answers 404 for GET / 200 for writes, which every
 * screen treats as "nothing here").
 */
export function respond({ method, path, query, role, options = {} }) {
  const p = path.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
  const get = method === 'GET';
  if (p === '/auth/sync') return profileFor(role);
  if (!get) return { ok: true };

  const byId = (list) => (id) => list.find((item) => item.id === decodeURIComponent(id));
  let match;

  if (p === '/config/features') return { flags: { aiPhotoShoot: true, outfitSwap: true, boosts: true, manufacturerHub: true }, updatedAt: null };
  // app/boost.tsx (Promote a post) fetches all three of these on load;
  // unseeded, they 404 on every single load of that screen. The demo seller
  // has no video/slideshow posts (only photo posts in the feed fixture, and
  // boost only accepts video/2+-image slideshows), so an honest empty state
  // — no eligible posts yet, no active boosts — is the real answer here,
  // not fabricated boost data.
  if (p === '/boosts/targets') return [];
  if (p === '/boosts/summary') return { totalImpressions: 0, spentCentsThisMonth: 0, activeCount: 0 };
  if (p === '/boosts') return [];
  if (p === '/auth/me') return profileFor(role);
  // Buyer account/settings screens the half-done audit crawls on load —
  // previously unseeded, so every one of these 404'd as soon as the screen
  // mounted (lib/safetyTypes.ts has the AccountDeletionCheck/AccountSession shapes).
  if (p === '/auth/feed-gestures-tip') return { seenVersion: 1 };
  if (p === '/auth/account/deletion-check') {
    return {
      canDelete: true,
      accountType: role,
      blockers: [],
      willDelete: ['Your posts, comments, likes and saved items', 'Your profile and follower/following lists'],
      willRetain: ['Order history required for tax and dispute records'],
    };
  }
  if (p === '/auth/sessions') {
    return {
      sessions: [{
        id: 'sess_demo_current', current: true, status: 'active',
        device: 'This device', browser: 'Chrome', isMobile: false,
        location: 'Portland, OR', ipAddress: null, lastActiveAt: iso(0), createdAt: iso(30 * DAY),
      }],
    };
  }
  if (p === '/auth/privacy') return { dmPrivacy: 'requests' };
  if (p === '/seller/subscription/status') return { plan: 'growth', status: 'active', trialEnd: null, trialStartAt: null, trialEndAt: null, trialBanner: null, renewsOn: 'Oct 14, 2026', amountCents: 2900, paymentMethodLabel: 'Visa ···4242', effectiveProvider: 'stripe' };
  if (p === '/team/context') return { role: 'owner', storeOwnerId: SELLER_USER.id, teamMembershipId: null };
  if (p === '/team/my-memberships') return { memberships: [] };

  // Storefront (seller) — half-done audit: /store-settings, /store-editor,
  // /store-ai-improve, /store-nav, /store-pages, /store-theme-picker and
  // /store-builder all fetch GET /store on load; unseeded, it 404'd on
  // every one of them. Shape matches the real storefronts table row
  // (lib/db/src/schema/index.ts) and api-server/src/routes/store.ts's
  // GET / handler — a plausible, in-progress Northline Studio storefront.
  if (p === '/store') {
    return {
      id: 'storefront_northline',
      ownerId: SELLER_USER.id,
      slug: 'northline-studio',
      title: 'Northline Studio',
      subtitle: 'Independent streetwear, small-batch heavyweight basics.',
      description: 'Considered pieces for everyday movement, cut heavy and made to last.',
      status: 'published',
      theme: {
        themeId: 'thread',
        primaryColor: '#111111',
        secondaryColor: '#6B6B6B',
        accentColor: '#2B2B2B',
        backgroundColor: '#F7F7F5',
        textColor: '#111111',
        fontFamily: 'Cormorant Garamond, Georgia, serif',
        borderRadius: 0,
      },
      branding: { tagline: 'The new uniform.', logoUrl: SELLER_USER.imageUrl, targetAudience: 'Streetwear buyers who want fewer, better pieces' },
      sections: [
        { id: 'thread-hero', type: 'hero_image', title: 'Hero Image', enabled: true, settings: { heading: 'The new uniform.', description: 'Considered pieces for everyday movement.', buttonLabel: 'Shop the collection', fullWidth: true, sectionHeight: 'tall' } },
        { id: 'thread-products', type: 'product_grid', title: 'Product Grid', enabled: true, settings: { heading: 'Current collection', description: 'The pieces in rotation.', columns: 2, quickAdd: false } },
        { id: 'thread-story', type: 'brand_story', title: 'Brand Story', enabled: true, settings: { heading: 'Designed with intention.', description: 'Fewer pieces, better made, and meant to be worn often.' } },
        { id: 'thread-newsletter', type: 'newsletter', title: 'Newsletter', enabled: true, settings: { heading: 'Stay close.', description: 'New releases, studio notes, and first access.', buttonLabel: 'Join the list' } },
      ],
      seo: { metaTitle: 'Northline Studio — Heavyweight streetwear', metaDescription: 'Small-batch heavyweight basics, made to last.' },
      socialLinks: {},
      analyticsCode: null,
      publishedAt: iso(9 * DAY),
      sharePreviewRevokedAt: null,
    };
  }
  // /store-builder also checks for an in-progress Shopify import on load
  // (getLatestShopifyImport()) — unseeded, this 404'd every time. `null` is
  // the real API's own "no import yet" answer (api-server's GET /latest).
  if (p === '/shopify-imports/latest') return null;
  // /store-versions fetches the saved version history on load — unseeded,
  // every load 404'd before any version ever showed. A couple of plausible
  // past saves (storeService.ts's getVersions() maps trigger/label/snapshot).
  if (p === '/store/versions') {
    return [
      { id: 'ver_nl_2', label: 'Before Drop 04 refresh', trigger: 'publish', snapshot: {}, createdAt: iso(2 * DAY), createdBy: SELLER_USER.id },
      { id: 'ver_nl_1', label: 'Initial Thread Theme setup', trigger: 'manual', snapshot: {}, createdAt: iso(9 * DAY), createdBy: SELLER_USER.id },
    ];
  }
  // /seller-verification fetches identity verification status on load —
  // unseeded, it 404'd before the screen could render anything. 'unverified'
  // is the same starting state a brand-new seller actually has.
  if (p === '/seller/verification/status') return { verified: false, verificationStatus: 'unverified', sessionId: null };
  // /vacation-mode fetches current vacation state on load — unseeded, every
  // load 404'd before the toggle could show its real value.
  if (p === '/seller/vacation') return { vacationMode: false, vacationMessage: null, vacationUntil: null };
  // /team and /users both fetch the member roster; /team also loads the
  // recent activity log. Unseeded, both 404'd on first render. The owner
  // row plus one active admin and one pending invite give the screens
  // something real to lay out (avatars, status pills, role chips).
  if (p === '/team/members') {
    return [
      { id: 'owner', email: SELLER_USER.email, name: 'Maya Okafor', role: 'owner', status: 'active', invitedAt: null, joinedAt: iso(180 * DAY), lastActiveAt: iso(0), memberClerkId: SELLER_USER.id, online: true, isOwner: true },
      { id: 'member_nl_1', email: 'devon@northlinestudio.co', name: 'Devon Cole', role: 'admin', status: 'active', invitedAt: iso(60 * DAY), expiresAt: null, expired: false, joinedAt: iso(58 * DAY), lastActiveAt: iso(3 * HOUR), memberClerkId: 'user_devon', online: false, isOwner: false },
      { id: 'member_nl_2', email: 'priya@northlinestudio.co', name: 'Priya Shah', role: 'marketing', status: 'pending', invitedAt: iso(2 * DAY), expiresAt: isoAhead(5 * DAY), expired: false, joinedAt: null, lastActiveAt: null, memberClerkId: null, online: false, isOwner: false },
    ];
  }
  if (p === '/team/activity') {
    return {
      logs: [
        { id: 'act_nl_1', ownerId: SELLER_USER.id, actorClerkId: SELLER_USER.id, actorRole: 'owner', message: 'Invited priya@northlinestudio.co as marketing', resourceType: 'team', resourceId: 'member_nl_2', createdAt: iso(2 * DAY) },
        { id: 'act_nl_2', ownerId: SELLER_USER.id, actorClerkId: 'user_devon', actorRole: 'admin', message: 'Updated the Drop 04 product grid', resourceType: 'store', resourceId: 'storefront_northline', createdAt: iso(3 * HOUR) },
      ],
      hasMore: false,
      nextOffset: 2,
    };
  }
  // /roles fetches the role tiers with live staff counts — unseeded, it
  // 404'd on load and the screen fell back to its own static placeholder
  // counts. Mirrors api-server/src/routes/team.ts's ROLE_DEFINITIONS, with
  // counts matching the /team/members seed above (one active admin, one
  // pending marketing invite).
  if (p === '/team/roles') {
    return [
      { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features including billing, payouts, and team management', permissions: ['*'], staffCount: 1, pendingCount: 0 },
      { key: 'admin', name: 'Admin', group: 'Organization', description: 'Manage products, orders, inventory, analytics, customers, marketing, payouts and the team', permissions: ['products', 'orders', 'inventory', 'analytics', 'customers', 'marketing', 'payouts', 'team'], staffCount: 1, pendingCount: 0 },
      { key: 'finance', name: 'Finance', group: 'Store', description: 'View balance, payouts, transactions and statements', permissions: ['payouts', 'analytics'], staffCount: 0, pendingCount: 0 },
      { key: 'orders', name: 'Orders', group: 'Store', description: 'Manage orders, fulfillment and inventory', permissions: ['orders', 'inventory'], staffCount: 0, pendingCount: 0 },
      { key: 'marketing', name: 'Marketing', group: 'Store', description: 'Manage ads, boosts and discount codes', permissions: ['marketing', 'analytics'], staffCount: 0, pendingCount: 1 },
      { key: 'viewer', name: 'Viewer', group: 'Store', description: 'Read-only access to analytics and store data', permissions: ['analytics'], staffCount: 0, pendingCount: 0 },
    ];
  }
  // /locations fetches the seller's fulfillment locations — unseeded, it
  // 404'd on load. Raw snake_case fields, matching the real handler's raw
  // SQL row shape (app/locations.tsx reads loc.is_active/is_primary directly).
  if (p === '/seller/locations') {
    return {
      locations: [
        { id: 'loc_nl_1', owner_id: SELLER_USER.id, name: 'Northline Studio — Warehouse', address: '4100 SE Division St', city: 'Portland', state: 'OR', country: 'US', zip: '97202', phone: '+1 503-555-0143', is_active: true, is_primary: true, fulfills_online_orders: true, created_at: iso(180 * DAY) },
      ],
    };
  }
  // /languages reads store localization settings via the shared seller
  // settings row — unseeded, it 404'd before the current language could
  // show. Matches api-server's seller-settings-route.ts ({ settings }).
  if (p === '/seller/settings') return { settings: { storeLanguage: 'en' } };
  // /notifications-settings fetches the buyer/seller-agnostic preference
  // endpoint (api.notificationPrefs, mounted at /api/notification-prefs,
  // distinct from /api/seller/notification-prefs) — unseeded, it 404'd on
  // load. Matches notification-prefs.ts's GET / response shape.
  if (p === '/notification-prefs') {
    return {
      digest: 'realtime',
      role: 'seller',
      pushEnabled: true,
      quietHours: { start: null, end: null, timezone: DEMO_TIME_ZONE },
      categories: {
        new_orders: true, production_milestones: true, payout_confirmations: true,
        customer_messages: true, disputes: true, subscription_trial: true, inventory_alerts: true,
      },
    };
  }
  // /shopify-import checks connection status on load — unseeded, it 404'd
  // before the screen could tell whether Shopify was connected. 'Not
  // connected yet' is the real starting state for a seller who hasn't set
  // up the bridge, matching serializeConnection()'s disconnected shape.
  if (p === '/shopify/status') return { connected: false, fulfillmentEnabled: false, linkedProductsCount: 0 };
  // /store-domain merges this with the local BT subdomain — unseeded, it
  // 404'd before that merge could even run. No custom domain yet is the
  // real starting state for a seller who hasn't connected one.
  if (p === '/store/domains') return [];
  // /store-policies reads the seller's saved shipping/returns/privacy
  // policies — unseeded, it 404'd before the screen's own "Add policies…"
  // empty state could render. No policies yet is the real starting state.
  if (p === '/seller/settings/policies') return { policies: [] };

  // Public / buyer
  if (p === '/public/products/high-demand') return PUBLIC_PRODUCTS.slice(0, Number(query.get('limit') ?? 6));
  if (p === '/public/products') {
    const ownerId = query.get('ownerId');
    const list = ownerId ? PUBLIC_PRODUCTS.filter((item) => item.sellerId === ownerId) : PUBLIC_PRODUCTS;
    return list.slice(0, Number(query.get('limit') ?? list.length));
  }
  if (p === '/public/drops') return DROPS.map(publicDrop);
  if ((match = p.match(/^\/public\/drops\/([^/]+)$/))) return DROPS.map(publicDrop).find((d) => d.id === match[1]);
  if ((match = p.match(/^\/public\/drops\/[^/]+\/notify$/))) return { subscribed: false };
  if (p === '/public/trending') return { trending: TRENDING.slice(0, Number(query.get('limit') ?? 20)) };
  if (p === '/public/search') return publicSearch(query.get('q') ?? '');
  if (p === '/public/search/trending') return { trending: [{ term: 'Hoodies', type: 'category' }, { term: 'Northline Studio', type: 'brand' }, { term: 'trail runner', type: 'query' }, { term: 'Outerwear', type: 'category' }] };
  // Fixed demo recent-search rows (real /api/public/search/recent is
  // per-user server history — see search.ts route) so the Search rebuild's
  // "Recent" section and "See all" page are screenshotable here.
  if (p === '/public/search/recent') return { recent: [{ query: 'hoodie', normalized: 'hoodie' }, { query: 'trail runner', normalized: 'trail runner' }, { query: 'Northline Studio', normalized: 'northline studio' }] };
  if (p === '/public/search/suggested') return searchSuggested();
  if (p === '/public/search/categories') return searchCategories();
  if (p === '/social/search') return searchPeople();
  // Own-profile screens (app/(buyer)/profile.tsx) resolve the signed-in
  // user's own social profile + posts through these — used only by
  // scripts/share-profile-1to1-screenshots.mjs for the share-profile
  // rebuild's live verification; not part of the shipped app.
  if ((match = p.match(/^\/social\/profile\/([^/]+)$/)) && decodeURIComponent(match[1]) === 'me') {
    const user = role === 'seller' ? SELLER_USER : BUYER_USER;
    const p2 = profileFor(role);
    return {
      userId: match[1], name: p2.name, username: p2.username,
      displayName: p2.displayName, bio: p2.bio, avatarUrl: user.imageUrl,
      accountType: p2.accountType, initials: p2.name.slice(0, 2).toUpperCase(), color: '#7A7A7A',
      handle: `@${p2.username}`, followersCount: 1280, followingCount: 340, postsCount: 6,
      isFollowing: false, isFollowedBy: false, isMutual: false, iBlockedThem: false,
    };
  }
  // One published + one draft buyer post, so the buyer profile's Drafts
  // sub-filter (item 117) has something real to show and hide between.
  if (p.match(/^\/social\/profile\/[^/]+\/posts$/)) {
    if (role !== 'buyer') return [];
    const buyerName = `${BUYER_USER.firstName} ${BUYER_USER.lastName}`;
    const base = {
      authorId: BUYER_USER.id, authorName: buyerName, authorHandle: '@' + BUYER_USER.username,
      authorInitials: buyerName.slice(0, 2).toUpperCase(), authorColor: '#7A7A7A',
      authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'friends_only',
      type: 'photo', hashtags: [], mediaColors: ['#7A7A7A', '#07070f'],
      likesCount: 0, commentsCount: 0, repostsCount: 0,
      likedByMe: false, repostedByMe: false, savedByMe: false, isArchived: false,
    };
    return [
      { ...base, id: 'buyer-post-published', caption: 'Fit check', isDraft: false, createdAt: iso(0), updatedAt: iso(0) },
      { ...base, id: 'buyer-post-draft', caption: 'Untitled draft', isDraft: true, createdAt: iso(0), updatedAt: iso(0) },
    ];
  }
  if (p === '/buyer/notifications/unread-count') return { count: 0 };
  if (p === '/buyer/saved') return [];
  if (p === '/buyer/orders') return [];
  // A single populated order so buyer-order-detail / -refund-request /
  // -return-request / -problem-report (all keyed by :orderId) render real
  // content instead of 404ing on load — see services/orderTypes.ts's
  // BuyerOrderView for the shape. Any id resolves to the same order
  // (there's no order list to link a *specific* id from in this harness).
  if ((match = p.match(/^\/buyer\/orders\/([^/]+)$/))) {
    const item = CATALOGUE[1]; // Field Shell Jacket — Rust
    const brand = BRANDS[item.brand];
    return {
      id: decodeURIComponent(match[1]),
      orderNumber: 'BT-10482',
      sellerId: brand.clerkId,
      sellerName: brand.name,
      sellerHandle: brand.handle,
      status: 'shipped',
      paymentStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
      lineItems: [{
        productId: item.id, productName: item.name, variant: 'L',
        quantity: 1, unitPriceCents: item.priceCents, imageUri: img(item.image),
      }],
      shippingAddress: {
        name: BUYER_USER.name, line1: '1120 NW Everett Street', line2: 'Apt 5C',
        city: 'Portland', state: 'OR', zip: '97209', country: 'US', phone: '+1 (503) 555-0142',
      },
      payment: { subtotalCents: item.priceCents, shippingTotalCents: 1200, taxTotalCents: 0, totalCents: item.priceCents + 1200 },
      trackingNumber: '1Z999AA10123456784',
      trackingCarrier: 'UPS',
      trackingStatus: 'in_transit',
      estimatedDelivery: isoAhead(2 * DAY),
      shippedAt: iso(1 * DAY),
      paidAt: iso(2 * DAY),
      isPreOrder: false,
      hasReturnRequest: false,
      isCustomerVisible: true,
      createdAt: iso(2 * DAY),
    };
  }
  if (p === '/buyer/addresses') return [];
  if (p === '/buyer/payment-methods') return { paymentMethods: [] };
  if (p === '/buyer/recently-viewed') return [];
  if (p === '/buyer/collections') return [];
  // { collection, items } — a bare array crashed buyer-collection.tsx
  // (reads response.collection.name / response.items.length).
  if ((match = p.match(/^\/buyer\/collections\/([^/]+)\/items$/))) {
    const id = decodeURIComponent(match[1]);
    return {
      collection: { id, name: 'Ember favorites', coverImageUrl: null, isPublic: true, sortOrder: 0, itemCount: 0, createdAt: iso(10 * DAY), updatedAt: iso(10 * DAY) },
      items: [],
    };
  }
  if (p === '/returns/buyer') return [];
  if (p === '/loyalty') return { balance: 0, valueCents: 0, history: [] };
  if (p === '/profile/cover-coachmark') return { seen: true };
  if (p === '/thread-cash') {
    return {
      balanceCents: options.fresh ? 0 : 4260,
      config: { dailyAmountCents: 10, streakBonusCents: 100, streakBonusDays: 7, graceHours: 20, expiryDays: 180, maxRedemptionPerOrderCents: 2000 },
      streak: { currentStreak: 0, longestStreak: 0, lastCheckInDate: null, timezone: 'UTC', alreadyCheckedInToday: false, dayInCycle: 0 },
    };
  }
  if (p === '/thread-cash/history') {
    if (options.fresh) return { history: [] };
    return {
      history: [
        { id: 'stc-1', buyerId: role, amountCents: 500, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: iso(0) },
        { id: 'stc-2', buyerId: role, amountCents: 200, source: 'send_received', referenceId: null, note: 'From Jordan Reyes', createdAt: iso(1 * DAY) },
        { id: 'stc-3', buyerId: role, amountCents: -2000, source: 'cash_out', referenceId: null, note: 'Cashed out to payout balance', createdAt: iso(2 * DAY) },
        { id: 'stc-4', buyerId: role, amountCents: 1500, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: iso(3 * DAY) },
        { id: 'stc-5', buyerId: role, amountCents: 60, source: 'send_received', referenceId: null, note: 'From Amara Chen', createdAt: iso(4 * DAY) },
        { id: 'stc-6', buyerId: role, amountCents: 4000, source: 'live_gift', referenceId: null, note: 'Gift during your Live', createdAt: iso(5 * DAY) },
      ],
    };
  }
  if (p === '/thread-cash/quote') {
    const threadCashCents = Number(query.get('threadCashCents') ?? 0) || 0;
    return { threadCashCents, payoutCents: threadCashCents, feeCents: 0 };
  }
  if (p === '/seller/profile') {
    const p2 = profileFor('seller');
    return {
      id: p2.id, clerkId: p2.clerkId, displayName: p2.displayName, brandName: p2.brandName,
      bio: p2.bio, website: null, username: p2.username, profileImageUrl: SELLER_USER.imageUrl,
      logoUrl: SELLER_USER.imageUrl, bannerUrl: null, category: null, tags: [], location: null,
      socialLinks: {}, contactEmail: null,
      // Owner-only read: the plan chip comes from here and nowhere public.
      subscriptionPlanId: 'growth', subscriptionStatus: 'active',
    };
  }
  // ── Profiles: public seller storefront, social profile card, tagged, videos ──
  if ((match = p.match(/^\/public\/sellers\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]);
    if (id !== SELLER_USER.id && id !== BRANDS.northline.id) return undefined;
    const products = PUBLIC_PRODUCTS.filter((item) => item.sellerId === SELLER_USER.id);
    return {
      profile: {
        clerkId: SELLER_USER.id, brandName: 'Northline Studio', displayName: 'Maya Okafor', username: 'northlinestudio',
        bio: 'Heavyweight basics, cut and sewn in Portland. New drop every season.', website: null,
        profileImageUrl: SELLER_USER.imageUrl, avatarUrl: SELLER_USER.imageUrl, verified: true, accountType: 'seller',
        brandType: 'clothing', vacationMode: false, productsCount: products.length, videosCount: 2, likesCount: 30200, followersCount: 24800, followingCount: 312,
      },
      products,
      posts: [],
    };
  }
  if ((match = p.match(/^\/social\/profile\/([^/]+)\/tagged$/))) {
    const id = decodeURIComponent(match[1]);
    if (id === SELLER_USER.id) {
      return [
        { id: 'tag_demo_1', authorId: BUYER_USER.id, authorName: 'Jordan Reyes', authorUsername: BUYER_USER.username, mediaUrl: img('look-mono'), thumbnailUrl: img('look-mono'), mediaType: 'photo', caption: 'Ember hoodie, finally', source: 'post' },
        { id: 'tag_demo_2', authorId: BUYER_USER.id, authorName: 'Jordan Reyes', authorUsername: BUYER_USER.username, mediaUrl: img('texture-ember'), thumbnailUrl: img('texture-ember'), mediaType: 'photo', caption: 'Rust jacket weather', source: 'post' },
        { id: 'tag_demo_story_1', authorId: BUYER_USER.id, authorName: 'Jordan Reyes', authorUsername: BUYER_USER.username, mediaUrl: img('look-mono'), thumbnailUrl: img('look-mono'), mediaType: 'story', caption: null, source: 'story' },
      ];
    }
    return [];
  }
  if ((match = p.match(/^\/social\/profile\/([^/]+)$/))) {
    const id = decodeURIComponent(match[1]);
    if (id === SELLER_USER.id) {
      return { userId: SELLER_USER.id, name: 'Northline Studio', username: 'northlinestudio', displayName: 'Maya Okafor', bio: null, avatarUrl: SELLER_USER.imageUrl, accountType: 'seller', initials: 'NS', color: '#2B2B30', handle: '@northlinestudio', followersCount: 24800, followingCount: 312, likesCount: 30200, postsCount: 2, isFollowing: false, isFollowedBy: false, isMutual: false, iBlockedThem: false };
    }
    if (id === BUYER_USER.id) {
      return { userId: BUYER_USER.id, name: 'Jordan Reyes', username: BUYER_USER.username, displayName: 'Jordan Reyes', bio: 'Thrift finds, tailoring, and the occasional grail.', avatarUrl: BUYER_USER.imageUrl, accountType: 'buyer', initials: 'JR', color: '#7A7A7A', handle: '@' + BUYER_USER.username, followersCount: 186, followingCount: 94, likesCount: 512, postsCount: 2, isFollowing: false, isFollowedBy: false, isMutual: false, iBlockedThem: false };
    }
    return undefined;
  }
  if ((match = p.match(/^\/public\/users\/([^/]+)\/videos$/)) && decodeURIComponent(match[1]) === SELLER_USER.id) {
    const videos = feedPosts().filter((post) => post.userId === SELLER_USER.id).map((post) => ({ ...post, authorAccountType: 'seller', viewsCount: 1200 }));
    return { user: { userId: SELLER_USER.id, accountType: 'seller', displayName: 'Northline Studio', username: 'northlinestudio' }, restricted: null, total: videos.length, hasMore: false, videos };
  }
  if ((match = p.match(/^\/public\/products\/([^/]+)\/related$/))) return PUBLIC_PRODUCTS.filter((item) => item.id !== match[1]).slice(0, 5);
  if ((match = p.match(/^\/public\/products\/([^/]+)$/))) return byId(PUBLIC_PRODUCTS)(match[1]);
  if (p.startsWith('/reviews/product/')) return REVIEWS;
  if (p.startsWith('/reviews/seller/')) return REVIEWS;
  if (p === '/public/posts' || p === '/posts/feed') return role === 'buyer' ? feedPosts() : [];
  // lib/appStartPrefetch.ts's warmSellerTabs() calls this on every seller
  // app boot — unseeded, it 404s on every single seller page load. The demo
  // feed already has two Northline Studio (the seller persona) posts;
  // these are exactly those, as "mine".
  if (p === '/posts/mine') return role === 'seller' ? feedPosts().filter((post) => post.userId === SELLER_USER.id) : [];
  if (p === '/posts/repost-context') return {};
  if (p === '/live/active') return { streams: [] };
  if (p.startsWith('/social/status/')) return { isFollowing: false, followersCount: 24800 };
  // Previously-unseeded buyer/social GETs hit on plain screen load (Activity,
  // Discover, Inbox, Friends, Search, own Profile, Blocked list) — every one
  // of these 404'd before the screen ever rendered. Real empty states (no
  // suggestions/activity/stories yet) rather than fabricated rows, since
  // none of these screens are the primary subject of a demo walkthrough.
  if (p === '/social/suggested') return [];
  if (p === '/social/friends/activity') return [];
  if (p === '/social/notes/following') return [];
  if (p === '/social/stories/following') return [];
  if (p === '/social/stories/me') return [];
  if (p.match(/^\/social\/stories\/user\/[^/]+$/)) return [];
  if (p === '/social/blocks') return [];
  if (p === '/safety/muted-words') return { words: [], limit: 50 };
  if (p.match(/^\/posts\/[^/]+\/comments$/)) return { comments: [], total: 0, hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, nextCursor: null };
  if ((match = p.match(/^\/social\/posts\/([^/]+)$/))) {
    // Real BuyerPost shape (services/socialTypes.ts) — not feedPosts()'s
    // different (seller/public feed) shape, so buyer-post-viewer's
    // post?.caption / post?.authorName actually override the placeholder
    // nav params instead of silently staying undefined.
    const buyerName = `${BUYER_USER.firstName} ${BUYER_USER.lastName}`;
    return {
      id: decodeURIComponent(match[1]),
      authorId: BUYER_USER.id, authorName: buyerName, authorHandle: '@' + BUYER_USER.username,
      authorInitials: buyerName.slice(0, 2).toUpperCase(), authorColor: '#7A7A7A',
      authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'friends_only',
      type: 'photo', caption: 'Fit check', hashtags: [], mediaColors: ['#7A7A7A', '#07070f'],
      likesCount: 12, commentsCount: 3, repostsCount: 0,
      likedByMe: false, repostedByMe: false, savedByMe: false, isArchived: false, isDraft: false,
      createdAt: iso(2 * HOUR), updatedAt: iso(2 * HOUR),
    };
  }
  if (p === '/referrals/code') return { code: 'JORDAN20', link: 'https://brandthread.app/r/JORDAN20', shareText: "Join me on Brandthread — use code JORDAN20 for $10 off your first order." };
  if (p === '/referrals/stats') return { invitesSent: 0, signups: 0, rewardsEarnedCents: 0 };
  if (p === '/public/discover/feed') return { items: [], computedAt: iso(0), source: 'empty', nextOffset: null };
  if (p.match(/^\/public\/users\/[^/]+\/videos$/)) return { user: null, restricted: null, total: 0, hasMore: false, videos: [] };
  if ((match = p.match(/^\/public\/drops\/([^/]+)\/notify$/))) return { subscribed: false };
  // u/[username] (a raw fetch, not the lib/api.ts client — see
  // app/u/[username].tsx's PublicProfileDto). Unknown handles correctly
  // fall through to `undefined` (a real 404), matching production.
  if ((match = p.match(/^\/public\/profiles\/([^/]+)$/))) {
    const handle = decodeURIComponent(match[1]);
    const brand = Object.values(BRANDS).find((b) => b.handle === handle);
    if (!brand) return undefined;
    return {
      id: brand.clerkId, username: brand.handle, accountType: 'seller',
      displayName: brand.name, bio: `${brand.name} — independent label.`,
      avatarUrl: brand.avatar, verified: brand.verified === true,
    };
  }
  // c/[collectionId] (also a raw fetch — see app/c/[collectionId].tsx's
  // PublicCollectionDto). Any id resolves to the same demo collection.
  if ((match = p.match(/^\/public\/collections\/([^/]+)$/))) {
    const items = PUBLIC_PRODUCTS.slice(0, 4).map((product, i) => ({
      id: `citem_${i}`, type: 'product', targetId: product.id, title: product.name,
      image: product.imageUrl, brand: product.sellerDisplayName, priceCents: product.priceCents,
    }));
    return {
      collection: { id: decodeURIComponent(match[1]), name: 'Ember favorites', coverImageUrl: items[0]?.image ?? null, itemCount: items.length, ownerName: BUYER_USER.name },
      items,
    };
  }
  // Discover's "From Brands You Follow" rail: the buyer follows Ember & Ash
  // and Field Office; each seller's public storefront lists their catalogue.
  if (p === '/social/following') {
    // Followers/Following lists PR: a mix of brands (seller accountType) and
    // buyers, with distinct followedAt timestamps so the "Sort by" bottom
    // sheet (Default / latest / earliest) visibly reorders the list, plus a
    // couple of "Follows me" mutuals for the tag.
    const rows = [
      { key: 'ember', ago: 90 * DAY, followsMe: false, accountType: 'seller' },
      { key: 'field', ago: 45 * DAY, followsMe: true, accountType: 'seller' },
      { userId: 'user_priya', name: 'Priya Nandan', username: 'priyan', handle: '@priyan', initials: 'PN', color: '#B45309', ago: 20 * DAY, followsMe: true, accountType: 'buyer' },
      { userId: 'user_theo', name: 'Theo Marsh', username: 'theomarsh', handle: '@theomarsh', initials: 'TM', color: '#0F766E', ago: 2 * DAY, followsMe: false, accountType: 'buyer' },
    ];
    const list = rows.map((r) => {
      const brand = r.key ? BRANDS[r.key] : null;
      return {
        userId: brand ? brand.clerkId : r.userId,
        name: brand ? brand.name : r.name,
        username: brand ? brand.handle : r.username,
        handle: brand ? brand.handle : r.handle,
        initials: brand ? brand.name.slice(0, 2).toUpperCase() : r.initials,
        color: r.color ?? '#7A7A7A',
        accountType: r.accountType,
        followedAt: iso(r.ago),
        isFollowing: true,
        followsMe: r.followsMe,
      };
    });
    const sort = query.get('sort');
    if (sort === 'earliest') list.sort((a, b) => new Date(a.followedAt) - new Date(b.followedAt));
    else list.sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
    return list;
  }
  // Followers list PR: two buyers who follow the demo account — the
  // viewer's own Followers list gets a "Remove" button per row (see
  // components/social/RemoveFollowerSheet.tsx).
  if (p === '/social/followers') {
    return [
      {
        userId: 'demo-follower-1', name: 'Priya Shah', username: 'priyashah', handle: '@priyashah',
        initials: 'PS', color: '#8B5CF6', accountType: 'buyer', followedAt: iso(6 * HOUR),
        isFollowingBack: false, isFollowing: false,
      },
      {
        userId: 'demo-follower-2', name: 'Marcus Webb', username: 'marcusw', handle: '@marcusw',
        initials: 'MW', color: '#EC4899', accountType: 'buyer', followedAt: iso(1 * DAY + 2 * HOUR),
        isFollowingBack: true, isFollowing: true,
      },
    ];
  }
  if ((match = p.match(/^\/public\/sellers\/([^/]+)$/))) {
    const brandKey = Object.keys(BRANDS).find((key) => BRANDS[key].clerkId === decodeURIComponent(match[1]));
    if (!brandKey) return { profile: null, products: [], posts: [] };
    const brand = BRANDS[brandKey];
    return {
      profile: { clerkId: brand.clerkId, displayName: brand.name, brandName: brand.name, verified: true, username: brand.handle },
      products: PUBLIC_PRODUCTS.filter((product) => product.sellerId === brand.clerkId),
      posts: [],
    };
  }
  if (p === '/buyer/cart') return (options.emptyCart || options.fresh) ? { items: [], savedItems: [] } : CART;
  // Seeded so the Activity redesign (swipe/menu/remove-follower/block, see
  // docs/activity-flows.md) has real rows to screenshot: two single-actor
  // new-follower rows (one unread → Highlights, one read → Today) and one
  // like row with a thumbnail.
  if (p === '/buyer/notifications') {
    return [
      {
        id: 'n-follow-1', category: 'social', type: 'new_follower',
        title: 'Priya Shah started following you', body: '', isRead: false, isMuted: false,
        actorId: 'demo-follower-1', actorName: 'Priya Shah', actorHandle: '@priyashah',
        actorInitials: 'PS', actorColor: '#8B5CF6',
        targetId: 'demo-follower-1', targetType: 'user', cta: 'Follow back',
        createdAt: iso(6 * HOUR),
      },
      {
        id: 'n-follow-2', category: 'social', type: 'new_follower',
        title: 'Marcus Webb started following you', body: '', isRead: true, isMuted: false,
        actorId: 'demo-follower-2', actorName: 'Marcus Webb', actorHandle: '@marcusw',
        actorInitials: 'MW', actorColor: '#EC4899',
        targetId: 'demo-follower-2', targetType: 'user', cta: 'Follow back',
        createdAt: iso(1 * DAY + 2 * HOUR),
      },
      {
        id: 'n-like-1', category: 'social', type: 'post_like',
        title: 'Jordan Lee liked your post', body: '', isRead: true, isMuted: false,
        actorId: 'demo-liker-1', actorName: 'Jordan Lee', actorHandle: '@jordanlee',
        actorInitials: 'JL', actorColor: '#3B82F6',
        targetId: 'post-1', targetType: 'post', targetImageUrl: PUBLIC_PRODUCTS[0]?.images?.[0] ?? null,
        createdAt: iso(3 * DAY),
      },
    ];
  }
  if (p === '/shipping-rates/calculate') return { shippingCents: 1200, rateName: 'Express courier (2–3 days)', isFree: false };
  // app/meta-ads-connect.tsx, app/meta-ads-manage.tsx and app/meta-ads-setup.tsx
  // all call this before showing anything — unseeded, it 404s on every load
  // of every Meta Ads screen. Honestly disconnected (no fabricated Meta
  // business/ad-account data): this demo seller hasn't run Meta's real OAuth.
  if (p === '/meta-ads/connection') return { connected: false, status: 'disconnected' };
  if (p === '/meta-ads/campaigns') return { campaigns: [] };

  // Seller
  if ((match = p.match(/^\/drops\/([^/]+)$/))) {
    const drop = DROPS.find((d) => d.id === match[1]);
    if (!drop) return undefined;
    const products = drop.products.map((id) => PUBLIC_PRODUCTS.find((pp) => pp.id === id)).filter(Boolean);
    return {
      id: drop.id, name: drop.name, status: drop.live ? 'live' : 'scheduled',
      releaseAt: isoAhead(drop.releaseIn), endsAt: isoAhead(drop.endsIn),
      heroImageUrl: products[0]?.images?.[0] ?? null, heroVideoUrl: null,
      earlyAccessMinutes: 30,
      products: products.map((pp) => ({ id: pp.id, name: pp.name, images: pp.images, stockRemaining: pp.remainingUnits })),
    };
  }
  if (p === '/analytics/home') return homeAnalytics(query.get('range') ?? 'today');
  // Seller dashboard's secondary (range-independent) fetch group, plus
  // lib/appStartPrefetch.ts's warmSellerTabs() app-boot prefetch — without
  // these seeded, api.products.list()/api.inventory.list()/api.analytics
  // .products() all 404 ("NOT_SEEDED") on every seller page load, which
  // spams a hard console-error finding on every audit run and (for a
  // role/account this fixture wasn't written for) can leave
  // SellerDashboardTrafficSources-adjacent state undefined. Real seller
  // products/inventory/top-sellers, not fabricated for this response alone.
  if (p === '/products') return role === 'seller' && !options.emptyProducts ? SELLER_PRODUCTS : [];
  if (p === '/inventory') return role === 'seller' ? SELLER_PRODUCTS.map((product) => product.inventory) : [];
  if (p === '/analytics/products') return role === 'seller'
    ? SELLER_PRODUCTS.filter((product) => product.totalRevenueCents > 0).map((product) => ({
      productId: product.id, name: product.name, unitsSold: product.totalSales, revenueCents: product.totalRevenueCents,
    }))
    : [];
  if (p === '/finance/balance') return options.fresh
    ? { available: { amount: 0, currency: 'usd', formatted: '$0.00' }, pending: { amount: 0, currency: 'usd', formatted: '$0.00' }, connected: false, payoutsEnabled: false, bankConnected: false, processingCashout: null }
    : { available: { amount: 184250, currency: 'usd', formatted: '$1,842.50' }, pending: { amount: 62740, currency: 'usd', formatted: '$627.40' }, connected: true, payoutsEnabled: true, bankConnected: true, processingCashout: null };
  if (p === '/finance/payouts') return { payouts: options.fresh ? [] : [
    { id: 'po_demo_1', arrivalDate: DEMO_NOW, formatted: '$412.30', status: 'paid', destination: { last4: '4242' } },
  ] };
  if (p === '/finance/summary') {
    const zero = { amount: 0, formatted: '$0.00' };
    return {
      currency: 'usd', connected: !options.fresh, stripeError: false,
      held: { ...zero, drops: [] }, releasing: { ...zero, count: 0 },
      available: zero, pending: zero, paidOut: { ...zero, toBank: zero },
      owed: zero, credit: zero,
      lifetime: { grossSales: zero, refunded: zero, platformFees: zero, processingFees: zero },
      activity: [],
    };
  }
  if (p === '/finance/transactions') return { transactions: [] };
  // Seeded honest-empty: none of these have sample/list content built for
  // the demo persona yet, so every one below is a real (not fabricated)
  // empty list/zero state — unseeded before, these were only 404ing because
  // no screen calling them was ever exercised by the screenshot scripts,
  // unlike every route the half-done audit newly started crawling.
  if (p === '/customers') return [];
  if ((match = p.match(/^\/customers\/([^/]+)$/))) return { id: match[1], name: 'Sample Customer', email: 'customer@example.com', totalSpentCents: 0, orderCount: 0, createdAt: iso(30 * DAY) };
  if ((match = p.match(/^\/customers\/([^/]+)\/orders$/))) return [];
  if (p === '/drops') return [];
  if (p === '/bundles') return [];
  if (p === '/shipping-zones') return [];
  if (p === '/shipping-zones/settings') return { shipFromCountry: 'US' };
  if (p === '/package-presets') return { presets: [] };
  if (p === '/shipping-rates') return [];
  if (p === '/returns') return [];
  // A single return/dispute/product this fixture doesn't have a real row
  // for still answers 200 with `null` ("not found", the screens' own
  // honest empty state) rather than a bare 404 — same reasoning as
  // sellerOrderDetail's fallback below, just without fabricating content
  // for surfaces this fixture doesn't model yet.
  if ((match = p.match(/^\/returns\/([^/]+)$/))) return null;
  if ((match = p.match(/^\/disputes\/([^/]+)$/))) return null;
  if ((match = p.match(/^\/products\/([^/]+)$/))) return byId(SELLER_PRODUCTS)(match[1]) ?? null;
  if (p === '/taxes/status') return {
    stripeTaxEnabled: false, provider: 'stripe', providerConfigured: true, providerStatus: 'not_enabled',
    automaticTaxAtCheckout: false, complianceNote: '', chargeShippingTax: false, chargeVat: false,
  };
  if (p === '/taxes/1099') return null;
  if (p === '/seller/metafields') return { counts: {} };
  // Rendered on every seller screen (StripeConnectWarning); unseeded, it
  // 404s on every single dashboard load, not just this route's own fetches.
  if (p === '/seller/connect/status') return { connected: true, stripeAccountId: 'acct_demo', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, status: 'active', verified: true, bankLast4: '4242', providerConfigured: true };
  if (p === '/orders') return sellerOrders(options.fresh ? 0 : options.orderCount ?? 9);
  if ((match = p.match(/^\/orders\/([^/]+)$/))) return sellerOrderDetail(match[1], options.fresh ? 0 : options.orderCount ?? 9);
  if (p === '/conversations') return role === 'seller' ? sellerConversations(options.fresh ? 0 : options.conversationCount ?? 5) : [];
  if (p === '/manufacturers/public') return MANUFACTURERS;
  if ((match = p.match(/^\/manufacturers\/public\/([^/]+)$/))) return byId(MANUFACTURERS)(match[1]);
  if (p === '/manufacturers/favorites') return [{ manufacturerId: MANUFACTURERS[0].id, createdAt: iso(50 * DAY) }, { manufacturerId: MANUFACTURERS[2].id, createdAt: iso(40 * DAY) }];
  if (p === '/manufacturers/relationships') return MANUFACTURERS.slice(0, 3).map((m, i) => ({ id: `rel-${i + 1}`, manufacturerId: m.id, status: 'active', createdAt: iso((90 - i * 20) * DAY), updatedAt: iso((i + 1) * DAY) }));
  if (p === '/manufacturers/threads') return MANUFACTURER_THREADS;
  if (p === '/seller-hub/quote-requests') return SELLER_QUOTE_REQUESTS;
  if ((match = p.match(/^\/seller-hub\/quote-requests\/([^/]+)$/))) return firstOr(SELLER_QUOTE_REQUESTS)(match[1]);
  if (p === '/sample-orders') return SAMPLE_ORDERS;
  if ((match = p.match(/^\/sample-orders\/([^/]+)\/images$/))) return { imageUrls: [] };
  if ((match = p.match(/^\/sample-orders\/([^/]+)$/))) return firstOr(SAMPLE_ORDERS)(match[1]);
  // RFQ broadcast (app/rfq-list.tsx, rfq-post.tsx, rfq-compare.tsx): no RFQs
  // exist yet in this fixture set (the seller hasn't posted one), so the
  // list is a real empty state, and a detail lookup falls back to a
  // representative quote-request-shaped RFQ rather than 404ing — same
  // reasoning as SAMPLE_ORDERS/SELLER_QUOTE_REQUESTS above.
  if (p === '/seller-hub/rfqs') return [];
  if ((match = p.match(/^\/seller-hub\/rfqs\/([^/]+)$/))) {
    const q = SELLER_QUOTE_REQUESTS[0];
    return {
      id: match[1], sellerId: SELLER_USER.id, garmentType: q.productName, category: 'Outerwear',
      description: q.notes ?? '', quantity: q.quantity, targetPriceCents: q.quotedPriceCents, deadline: q.quoteValidUntil,
      fileIds: [], status: 'matched', manufacturersCount: 3, quotesReceivedCount: 1,
      createdAt: q.createdAt, updatedAt: q.updatedAt,
      quotes: [{
        id: 'rfq-quote-1', sellerId: SELLER_USER.id, manufacturerId: q.manufacturerId, rfqId: match[1],
        productName: q.productName, quantity: q.quantity, status: 'quoted', quotedPriceCents: q.quotedPriceCents,
        quotedTurnaround: q.quotedTurnaround, quoteValidUntil: q.quoteValidUntil, counteroffer: null, notes: q.notes ?? null,
        manufacturerName: MANUFACTURERS.find((m) => m.id === q.manufacturerId)?.businessName ?? 'Manufacturer',
        manufacturerCountry: MANUFACTURERS.find((m) => m.id === q.manufacturerId)?.country ?? '',
        manufacturerIsVerified: true, createdAt: q.createdAt, updatedAt: q.updatedAt,
      }],
    };
  }
  if (p === '/seller-hub/manufacturers') return MANUFACTURERS.map((m) => ({ id: m.id, businessName: m.businessName, country: m.country, specialty: m.specialty, moq: m.moq, isVerified: !!m.isVerified }));
  if ((match = p.match(/^\/manufacturers\/orders\/([^/]+)\/timeline$/))) return productionTimelineFor(match[1]);
  if (p === '/manufacturers/invite-tokens') return [];
  if (p === '/freelancer-jobs') return { isFreelancer: false, asHirer: [], asFreelancer: [] };
  if ((match = p.match(/^\/freelancers\/(?!me$)([^/]+)$/))) return { freelancer: null };
  if (p === '/call/availability') return { configured: false };

  // Authed endpoints the audit script (scripts/audit/half-done-audit.mjs)
  // found hitting the "not seeded" 404 below across dozens of routes — every
  // one of them is a real, already-implemented api-server route (verified
  // against artifacts/api-server/src/routes/*.ts one by one; see the PR
  // description). The app was never missing a backend endpoint — this mock
  // simply hadn't grown a handler for anything past the public/buyer-preview
  // surface the original screenshot script needed. Zero-state ("fresh
  // preview") shapes throughout, matching this file's existing convention
  // and every consumer's own defensive `?? []`/`Array.isArray` handling.
  // (/products, /posts/mine and /inventory are seeded once, above, with
  // real per-role data rather than a blanket [] here.)
  if (p === '/ad-campaigns') return [];
  if (p === '/discount-codes') return [];
  if (p === '/loyalty') return { enrolled: false, pointsBalance: 0, tiers: [] };
  if (p === '/referrals/stats') return { referralCode: null, totalReferred: 0, totalRewardCents: 0, pending: [] };
  if (p === '/design-studio/projects') return [];
  if (p === '/moderation/me') return { flags: [], strikes: 0, restricted: false };
  if (p === '/social/blocks') return [];
  if (p === '/social/suggested') return [];
  if (p === '/social/friends/activity') return [];
  if (p === '/social/notes/following') return { notes: [] };
  if (p === '/social/stories/following') return { stories: [] };
  if (p === '/social/stories/me') return null;
  if (p === '/buyer/addresses') return [];
  if (p === '/buyer/payment-methods') return [];
  if (p === '/buyer/recently-viewed') return [];
  if ((match = p.match(/^\/buyer\/collections\/[^/]+\/items$/))) return [];
  // (/boosts, /boosts/summary and /boosts/targets are seeded once, above,
  // with the real Summary field names the client actually reads.)
  if (p === '/auth/feed-gestures-tip') return { seenVersion: 0 };
  if (p === '/auth/account/deletion-check') return { canDelete: true, accountType: role, blockers: [], willDelete: [], willRetain: [] };
  if (p === '/auth/sessions') return { sessions: [] };
  if (p === '/freelancers') return { freelancers: [] };
  if (p === '/freelancers/me') return { freelancer: null };
  // (/seller/connect/status is seeded once, above, as connected: true — this
  // demo seller's setup checklist already marks "connect_payments" done and
  // /finance/balance already reports connected: true, so a second,
  // contradicting "not_connected" answer here would disagree with the rest
  // of this same demo persona.)
  if (p === '/seller/subscription/invoices') return [];
  if (p === '/integrations/klaviyo') return { connected: false };
  if (p === '/analytics/revenue') return { totalCents: 0, orderCount: 0, daily: [] };
  // (/analytics/products is seeded once, above, with real per-role data.)
  if (p === '/analytics/customers') return { stats: {} };
  if (p === '/public/discover/feed') return { items: [], computedAt: iso(0), source: 'empty', nextOffset: null };
  // 'col_nl_ember' is the audit's fixed dynamic-route param value for
  // [collectionId] (see PARAM_VALUES in scripts/audit/half-done-audit.mjs) —
  // give it a real "Save to collection" board so /c/[collectionId] renders
  // its ready state instead of a 404-driven "not found" every run.
  if (p === '/public/collections/col_nl_ember') {
    return {
      collection: { id: 'col_nl_ember', name: 'Ember Season Picks', coverImageUrl: img('hoodie-ember'), itemCount: 1, ownerName: BRANDS.ember.name },
      items: [{ id: 'ci-1', type: 'product', targetId: PUBLIC_PRODUCTS[0]?.id ?? 'p1', title: PUBLIC_PRODUCTS[0]?.name ?? 'Heavyweight Hoodie', image: img('hoodie-ember'), brand: BRANDS.ember.name, priceCents: PUBLIC_PRODUCTS[0]?.priceCents ?? 8800 }],
    };
  }

  return undefined;
}

/** localStorage values the app reads on web (AsyncStorage is localStorage there). */
export function localStorageSeed(role, options = {}) {
  const user = role === 'seller' ? SELLER_USER : BUYER_USER;
  const seed = {
    'bt:cookie-consent': JSON.stringify({ version: 1, timestamp: DEMO_NOW, necessary: true, analytics: false, marketing: false }),
    'bt:feature-flags:v1': JSON.stringify({ aiPhotoShoot: true, outfitSwap: true, boosts: true, manufacturerHub: true }),
    [`@brandthread/app-theme:v1:${user.id}`]: options.themeId ?? 'monochrome',
    '@brandthread/app-theme:v1:guest': options.themeId ?? 'monochrome',
  };
  // `options.fresh`: a brand-new account — skips the "already set up"
  // seeds below so onboarding/empty states render instead of the fully
  // populated demo, for the notch crawl's fresh-account pass (some chrome,
  // e.g. an onboarding checklist banner, only exists in this state and
  // isn't covered by the always-populated default demo pass).
  if (role === 'buyer' && !options.fresh) {
    seed[`bt:checkout:${user.id}:v1`] = JSON.stringify(checkoutSession());
    seed['bt:repost-education:preview:v1'] = '1';
    // Own avatar (local-only field — see lib/buyerProfile.ts) so the
    // share-profile SELFIE background variant has something to show;
    // used only by scripts/share-profile-1to1-screenshots.mjs.
    seed[`bt:buyer-profile:${user.id}:v2`] = JSON.stringify({ avatarUri: user.imageUrl });
  }
  if (role === 'seller') {
    if (!options.fresh) {
      // A finished "Set up your business" checklist, so the dashboard shows the business, not onboarding.
      const done = ['verify_account', 'connect_payments', 'first_product', 'shipping_rates', 'customize_store', 'publish_store', 'first_post', 'connect_manufacturer'];
      seed[`@brandthread/setup_state:${user.id}`] = JSON.stringify({
        started: true, dismissed: false, currentStep: null,
        tasks: [...done.map((id) => ({ id, completed: true })), { id: 'connect_domain', skipped: true }],
        dismissedTips: [], openedFeatures: ['create-post'], lastUpdated: DEMO_NOW,
      });
    }
    seed['@brandthread/products'] = JSON.stringify(options.fresh ? [] : options.productCount ? manySellerProducts(options.productCount) : SELLER_PRODUCTS);
    seed['@brandthread/migration_v1_demo_purged'] = '1';
  }
  return seed;
}

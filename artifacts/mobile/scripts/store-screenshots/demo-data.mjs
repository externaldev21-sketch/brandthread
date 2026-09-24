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
  northline: { id: 'seller_northline', clerkId: SELLER_USER.id, name: 'Northline Studio', handle: 'northlinestudio', avatar: img('portrait-rust') },
  ember: { id: 'seller_ember', clerkId: 'user_ember', name: 'Ember & Ash', handle: 'emberandash', avatar: img('texture-ember') },
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
  { brand: 'northline', caption: 'Drop 04 is live. Ember hoodies restocked in every size.' },
  { brand: 'field', caption: 'Trail Runner 02 — built for city miles and weekend trails.' },
  { brand: 'quiet', caption: 'Moss, midnight and bone. The loopback capsule lands Friday.' },
  { brand: 'ember', caption: 'Behind the seams: how we cut the Onyx anorak.' },
  { brand: 'northline', caption: 'Studio day. Sampling the FW26 cargo in rust.' },
  { brand: 'field', caption: 'Clay or stone? Vote for the next colourway.' },
].map((row, i) => ({ id: `post_trending_${i + 1}`, rank: i + 1, brand: BRANDS[row.brand].name, brandId: BRANDS[row.brand].id, caption: row.caption }));

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
  if (p === '/auth/me') return profileFor(role);
  if (p === '/seller/subscription/status') return { plan: 'growth', status: 'active', trialEnd: null, trialStartAt: null, trialEndAt: null, trialBanner: null, renewsOn: 'Oct 14, 2026', amountCents: 2900, paymentMethodLabel: 'Visa ···4242', effectiveProvider: 'stripe' };
  if (p === '/team/context') return { role: 'owner', storeOwnerId: SELLER_USER.id, teamMembershipId: null };
  if (p === '/team/my-memberships') return { memberships: [] };

  // Public / buyer
  if (p === '/public/products/high-demand') return PUBLIC_PRODUCTS.slice(0, Number(query.get('limit') ?? 6));
  if (p === '/public/products') return PUBLIC_PRODUCTS.slice(0, Number(query.get('limit') ?? PUBLIC_PRODUCTS.length));
  if (p === '/public/drops') return DROPS.map(publicDrop);
  if ((match = p.match(/^\/public\/drops\/([^/]+)$/))) return DROPS.map(publicDrop).find((d) => d.id === match[1]);
  if (p === '/public/trending') return { trending: TRENDING.slice(0, Number(query.get('limit') ?? 20)) };
  if ((match = p.match(/^\/public\/products\/([^/]+)\/related$/))) return PUBLIC_PRODUCTS.filter((item) => item.id !== match[1]).slice(0, 5);
  if ((match = p.match(/^\/public\/products\/([^/]+)$/))) return byId(PUBLIC_PRODUCTS)(match[1]);
  if (p.startsWith('/reviews/product/')) return REVIEWS;
  if (p === '/public/posts' || p === '/posts/feed') return role === 'buyer' ? feedPosts() : [];
  if (p === '/posts/repost-context') return {};
  if (p === '/live/active') return { streams: [] };
  if (p.startsWith('/social/status/')) return { isFollowing: false, followersCount: 24800 };
  if (p === '/buyer/cart') return CART;
  if (p === '/buyer/notifications') return [];
  if (p === '/shipping-rates/calculate') return { shippingCents: 1200, rateName: 'Express courier (2–3 days)', isFree: false };

  // Seller
  if (p === '/analytics/home') return homeAnalytics(query.get('range') ?? 'today');
  if (p === '/finance/balance') return { available: { amount: 184250, currency: 'usd', formatted: '$1,842.50' }, pending: { amount: 62740, currency: 'usd', formatted: '$627.40' }, connected: true, payoutsEnabled: true, bankConnected: true, processingCashout: null };
  if (p === '/orders') return sellerOrders(options.orderCount ?? 9);
  if (p === '/conversations') return role === 'seller' ? sellerConversations(options.conversationCount ?? 5) : [];
  if (p === '/manufacturers/public') return MANUFACTURERS;
  if ((match = p.match(/^\/manufacturers\/public\/([^/]+)$/))) return byId(MANUFACTURERS)(match[1]);
  if (p === '/manufacturers/favorites') return [{ manufacturerId: MANUFACTURERS[0].id, createdAt: iso(50 * DAY) }, { manufacturerId: MANUFACTURERS[2].id, createdAt: iso(40 * DAY) }];
  if (p === '/manufacturers/relationships') return MANUFACTURERS.slice(0, 3).map((m, i) => ({ id: `rel-${i + 1}`, manufacturerId: m.id, status: 'active', createdAt: iso((90 - i * 20) * DAY), updatedAt: iso((i + 1) * DAY) }));
  if (p === '/manufacturers/threads') return MANUFACTURER_THREADS;
  if (p === '/seller-hub/quote-requests') {
    return [
      { id: 'qr-1', manufacturerId: MANUFACTURERS[2].id, productName: 'Field Shell Jacket — Onyx', status: 'quoted', type: 'bulk', quantity: 300, colorways: 'Onyx, Rust', quotedPriceCents: 1260000, quotedTurnaround: '35 days', quoteValidUntil: isoAhead(21 * DAY), notes: '30% deposit, balance before ship', createdAt: iso(14 * DAY), updatedAt: iso(3 * DAY) },
      { id: 'qr-2', manufacturerId: MANUFACTURERS[0].id, productName: 'Heavyweight Hoodie — Bone', status: 'quoted', type: 'bulk', quantity: 250, quotedPriceCents: 575000, quotedTurnaround: '28 days', quoteValidUntil: isoAhead(14 * DAY), createdAt: iso(12 * DAY), updatedAt: iso(5 * DAY) },
      { id: 'qr-3', manufacturerId: MANUFACTURERS[1].id, productName: 'Garment-Dyed Hoodie — Moss', status: 'submitted', type: 'bulk', quantity: 400, createdAt: iso(2 * DAY), updatedAt: iso(2 * DAY) },
    ];
  }
  if (p === '/sample-orders') {
    return [
      { id: 'so-1', manufacturerId: MANUFACTURERS[0].id, manufacturerName: 'Porto Knit Collective', title: 'Heavyweight Hoodie — Bone', status: 'delivered', orderType: 'sample', priceCents: 8500, quantity: 1, revision: 2, threadId: 'th-1', createdAt: iso(21 * DAY), updatedAt: iso(3 * DAY) },
      { id: 'so-2', manufacturerId: MANUFACTURERS[2].id, manufacturerName: 'Harbour Outerwear', title: 'Field Shell Proto', status: 'cut_and_sew', orderType: 'sample', priceCents: 14000, quantity: 1, revision: 1, createdAt: iso(10 * DAY), updatedAt: iso(2 * DAY) },
      { id: 'bo-1', manufacturerId: MANUFACTURERS[0].id, manufacturerName: 'Porto Knit Collective', title: 'FW26 Core Hoodie Run', status: 'cut_and_sew', orderType: 'bulk', priceCents: 1680000, quantity: 300, revision: 3, threadId: 'th-1', createdAt: iso(33 * DAY), updatedAt: iso(4 * DAY) },
      { id: 'bo-2', manufacturerId: MANUFACTURERS[1].id, manufacturerName: 'LA Garment Works', title: 'Moss Hoodie Restock', status: 'payment_received', orderType: 'bulk', priceCents: 468000, quantity: 400, revision: 1, createdAt: iso(7 * DAY), updatedAt: iso(6 * DAY) },
    ];
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
  if (role === 'buyer') {
    seed[`bt:checkout:${user.id}:v1`] = JSON.stringify(checkoutSession());
    seed['bt:repost-education:preview:v1'] = '1';
  }
  if (role === 'seller') {
    // A finished "Set up your business" checklist, so the dashboard shows the business, not onboarding.
    const done = ['verify_account', 'connect_payments', 'first_product', 'shipping_rates', 'customize_store', 'publish_store', 'first_post', 'connect_manufacturer'];
    seed[`@brandthread/setup_state:${user.id}`] = JSON.stringify({
      started: true, dismissed: false, currentStep: null,
      tasks: [...done.map((id) => ({ id, completed: true })), { id: 'connect_domain', skipped: true }],
      dismissedTips: [], openedFeatures: ['create-post'], lastUpdated: DEMO_NOW,
    });
    seed['@brandthread/products'] = JSON.stringify(options.productCount ? manySellerProducts(options.productCount) : SELLER_PRODUCTS);
    seed['@brandthread/migration_v1_demo_purged'] = '1';
  }
  return seed;
}

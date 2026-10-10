/**
 * Local data for the seller analytics reports in the dev web preview
 * (`?bt_preview=seller`) ONLY. Signed-in sellers always go through the real
 * API (services/sellerInsightsService.ts) and never touch this file.
 *
 *   - 'empty' (default, no &demo=1): a brand-new store — every number is a
 *     real 0 and every list is empty, so the honest empty states render.
 *   - 'demo' (&demo=1): deterministic, range-varying sample data so every
 *     report can be reviewed populated. Seeded (no Math.random) so a screen
 *     renders identically across re-renders.
 *
 * Bucket timestamps are built from local Date components so the chart
 * labels (lib/sellerHomeChartLabels.ts) read them exactly like the API's.
 */
import type {
  AdvancedStats, AudienceStats, ContentStats, Goal, InsightRange, InsightWindow, ProductStats,
} from '@/services/sellerInsightsService';

type Mode = 'demo' | 'empty';

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED: Record<InsightRange, number> = { today: 11, week: 22, month: 33, year: 44, all: 55 };

/** Bucket start instants for a range, in local time, never past "now". */
export function previewBuckets(range: InsightRange, now = new Date()): { starts: Date[]; window: InsightWindow } {
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate();
  const starts: Date[] = [];
  let step: InsightWindow['step'] = '1 hour';
  let start: Date;
  if (range === 'today') {
    start = new Date(y, m, d);
    for (let h = 0; h <= now.getHours(); h++) starts.push(new Date(y, m, d, h));
  } else if (range === 'week') {
    step = '1 day';
    start = new Date(y, m, d - now.getDay());
    for (let i = 0; i <= now.getDay(); i++) starts.push(new Date(y, m, start.getDate() + i));
  } else if (range === 'month') {
    step = '1 day';
    start = new Date(y, m, 1);
    for (let i = 1; i <= d; i++) starts.push(new Date(y, m, i));
  } else if (range === 'year') {
    step = '1 month';
    start = new Date(y, 0, 1);
    for (let i = 0; i <= m; i++) starts.push(new Date(y, i, 1));
  } else {
    step = '1 week';
    start = new Date(y, m, d - 7 * 11 - now.getDay());
    for (let i = 0; i < 12; i++) starts.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * i));
  }
  const last = starts[starts.length - 1] ?? start;
  const end = new Date(last.getTime() + (step === '1 hour' ? 3600e3 : step === '1 day' ? 864e5 : step === '1 week' ? 7 * 864e5 : 31 * 864e5));
  return { starts, window: { range, start: start.toISOString(), end: end.toISOString(), step } };
}

/** A gentle, seeded curve with a weekend / evening bump so charts look alive. */
function curve(range: InsightRange, count: number, base: number, rand: () => number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const frac = count > 1 ? i / (count - 1) : 1;
    const shape = range === 'today' ? 0.35 + 0.65 * Math.max(0, Math.sin(frac * Math.PI)) : 0.5 + 0.5 * Math.sin(frac * 5.5) * 0.6 + frac * 0.3;
    return Math.max(0, Math.round(base * shape * (0.7 + rand() * 0.6)));
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

const PRODUCTS = [
  { productId: 'p1', name: 'Heavyweight Hoodie — Ember', imageUrl: 'https://cdn.brandthread.test/demo/hoodie-ember.jpg', price: 9800, share: 0.42 },
  { productId: 'p2', name: 'Field Shell Jacket — Rust', imageUrl: 'https://cdn.brandthread.test/demo/jacket-rust.jpg', price: 22000, share: 0.26 },
  { productId: 'p3', name: 'Utility Cargo Pant — Rust', imageUrl: 'https://cdn.brandthread.test/demo/cargo-rust.jpg', price: 12800, share: 0.19 },
  { productId: 'p4', name: 'Heavyweight Hoodie — Bone', imageUrl: 'https://cdn.brandthread.test/demo/hoodie-bone.jpg', price: 9800, share: 0.13 },
];
const POSTS = [
  { postId: 'v1', type: 'video' as const, caption: 'Drop 04 behind the scenes', thumbnailUrl: 'https://cdn.brandthread.test/demo/hoodie-ember.jpg', share: 0.46 },
  { postId: 'v2', type: 'video' as const, caption: 'Hoodie fit check, sizes S to XL', thumbnailUrl: 'https://cdn.brandthread.test/demo/hoodie-bone.jpg', share: 0.27 },
  { postId: 'i1', type: 'image' as const, caption: 'Field Shell Jacket on the street', thumbnailUrl: 'https://cdn.brandthread.test/demo/jacket-rust.jpg', share: 0.17 },
  { postId: 's1', type: 'slideshow' as const, caption: 'Cargo pant, 5 ways', thumbnailUrl: 'https://cdn.brandthread.test/demo/cargo-rust.jpg', share: 0.10 },
];

const emptyContentTotals = () => ({ views: 0, uniqueViewers: 0, likes: 0, comments: 0, shares: 0, saves: 0, productClicks: 0, addToCarts: 0, purchases: 0, revenueCents: 0, avgWatchSeconds: null, followerGrowth: 0, profileVisits: 0 });
const emptyAdvancedTotals = () => ({ orders: 0, revenueCents: 0, refundedCents: 0, refundedOrders: 0, discountedOrders: 0, discountCents: 0, threadOrders: 0, threadRevenueCents: 0, buyers: 0, units: 0, visits: 0, averageOrderCents: 0, unitsPerOrder: 0, conversionPct: 0, refundRatePct: 0 });

export function previewInsights(range: InsightRange, mode: Mode, now = new Date()) {
  const { starts, window } = previewBuckets(range, now);
  const iso = starts.map(s => s.toISOString());
  const empty: SplitEmpty = { suppressed: true, total: null, new: null, returning: null };
  if (mode === 'empty') {
    const products: ProductStats = {
      window, totals: { views: 0, uniqueViewers: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0, viewToCartPct: null, cartToPurchasePct: null, viewToPurchasePct: null },
      previous: range === 'all' ? null : { views: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0 },
      deltas: { viewsPct: range === 'all' ? null : 0, addToCartsPct: range === 'all' ? null : 0, purchasesPct: range === 'all' ? null : 0, revenuePct: range === 'all' ? null : 0 },
      buckets: iso.map(bucket => ({ bucket, views: 0, purchases: 0 })), products: [],
    };
    const content: ContentStats = {
      window, totals: emptyContentTotals(), previous: range === 'all' ? null : emptyContentTotals(),
      deltas: { viewsPct: null, likesPct: null, commentsPct: null, sharesPct: null, savesPct: null, followerGrowthPct: null, revenuePct: null },
      buckets: iso.map(bucket => ({ bucket, views: 0, likes: 0 })),
      byType: [{ type: 'video', posts: 0, views: 0 }, { type: 'image', posts: 0, views: 0 }, { type: 'slideshow', posts: 0, views: 0 }], posts: [],
    };
    const audience: AudienceStats = {
      window, minGroupSize: 5, followers: { total: 0, gained: 0, previousGained: range === 'all' ? null : 0, gainedPct: null },
      buckets: iso.map(bucket => ({ bucket, followers: 0 })), buyers: empty, viewers: empty, topCountries: [], topRegions: [], hiddenLocations: 0, devices: [], deviceVisits: 0,
    };
    const advanced: AdvancedStats = {
      window, totals: { ...emptyAdvancedTotals(), repeatBuyers: 0, repeatBuyerPct: 0 }, previous: range === 'all' ? null : emptyAdvancedTotals(),
      deltas: { averageOrderPct: null, conversionPct: null, refundRatePct: null, revenuePct: null },
      channels: [{ channel: 'threads', orders: 0, revenueCents: 0 }, { channel: 'store', orders: 0, revenueCents: 0 }],
      buckets: iso.map(bucket => ({ bucket, orders: 0, revenueCents: 0, averageOrderCents: 0 })), topCustomers: [],
    };
    return { products, content, audience, advanced, goals: [] as Goal[] };
  }

  const rand = mulberry32(SEED[range]);
  const scale = { today: 1, week: 5, month: 18, year: 160, all: 220 }[range];
  const viewsSeries = curve(range, iso.length, 46 * scale / Math.max(1, iso.length / 8), rand);
  const views = sum(viewsSeries);
  const purchasesSeries = viewsSeries.map(v => Math.round(v * 0.034 * (0.6 + rand() * 0.8)));
  const purchases = sum(purchasesSeries);
  const addToCarts = Math.round(views * 0.115);
  const prevFactor = 0.78 + rand() * 0.35;

  const productRows = PRODUCTS.map((p, i) => {
    const pv = Math.round(views * p.share);
    const pc = Math.round(addToCarts * p.share);
    const pp = Math.max(i === 0 ? 1 : 0, Math.round(purchases * p.share));
    const units = Math.round(pp * 1.2);
    return {
      productId: p.productId, name: p.name, imageUrl: p.imageUrl, stock: 12 + i * 9,
      views: pv, uniqueViewers: Math.round(pv * 0.62), addToCarts: pc, purchases: pp, units, revenueCents: units * p.price,
      viewToCartPct: pct(pc, pv), cartToPurchasePct: pct(pp, pc), viewToPurchasePct: pct(pp, pv),
    };
  });
  const revenueCents = sum(productRows.map(p => p.revenueCents));
  const units = sum(productRows.map(p => p.units));
  const prevProducts = { views: Math.round(views * prevFactor), addToCarts: Math.round(addToCarts * prevFactor), purchases: Math.round(purchases * prevFactor), units: Math.round(units * prevFactor), revenueCents: Math.round(revenueCents * prevFactor) };
  const products: ProductStats = {
    window,
    totals: { views, uniqueViewers: Math.round(views * 0.62), addToCarts, purchases, units, revenueCents, viewToCartPct: pct(addToCarts, views), cartToPurchasePct: pct(purchases, addToCarts), viewToPurchasePct: pct(purchases, views) },
    previous: range === 'all' ? null : prevProducts,
    deltas: range === 'all' ? { viewsPct: null, addToCartsPct: null, purchasesPct: null, revenuePct: null }
      : { viewsPct: delta(views, prevProducts.views), addToCartsPct: delta(addToCarts, prevProducts.addToCarts), purchasesPct: delta(purchases, prevProducts.purchases), revenuePct: delta(revenueCents, prevProducts.revenueCents) },
    buckets: iso.map((bucket, i) => ({ bucket, views: viewsSeries[i], purchases: purchasesSeries[i] })),
    products: productRows,
  };

  const postViewsSeries = curve(range, iso.length, 130 * scale / Math.max(1, iso.length / 8), rand);
  const postViews = sum(postViewsSeries);
  const likesSeries = postViewsSeries.map(v => Math.round(v * 0.08));
  const totals: ContentStats['totals'] = {
    views: postViews, uniqueViewers: Math.round(postViews * 0.58), likes: sum(likesSeries), comments: Math.round(postViews * 0.007),
    shares: Math.round(postViews * 0.01), saves: Math.round(postViews * 0.018), productClicks: Math.round(postViews * 0.036),
    addToCarts: Math.round(postViews * 0.009), purchases: Math.max(1, Math.round(postViews * 0.0025)), revenueCents: Math.max(1, Math.round(postViews * 0.0025)) * 10400,
    avgWatchSeconds: 11.4, followerGrowth: Math.round(postViews * 0.012), profileVisits: Math.round(postViews * 0.046),
  };
  const prevTotals: ContentStats['totals'] = {
    ...totals, views: Math.round(totals.views * prevFactor), likes: Math.round(totals.likes * prevFactor), comments: Math.round(totals.comments * prevFactor),
    shares: Math.round(totals.shares * prevFactor), saves: Math.round(totals.saves * prevFactor), followerGrowth: Math.round(totals.followerGrowth * prevFactor), revenueCents: Math.round(totals.revenueCents * prevFactor),
  };
  const postRows = POSTS.map((p, i) => {
    const v = Math.round(postViews * p.share);
    const buys = Math.round(totals.purchases * p.share);
    return {
      postId: p.postId, type: p.type, thumbnailUrl: p.thumbnailUrl, caption: p.caption,
      views: v, likes: Math.round(v * 0.08), comments: Math.round(v * 0.007), saves: Math.round(v * 0.018), shares: Math.round(v * 0.01),
      productClicks: Math.round(v * 0.036), purchases: buys, revenueCents: buys * 10400,
      avgWatchSeconds: p.type === 'video' ? Math.round((9 + i * 2.3) * 10) / 10 : null,
      publishedAt: new Date(now.getTime() - (i + 1) * 36e5 * (range === 'today' ? 3 : 40)).toISOString(),
    };
  });
  const content: ContentStats = {
    window, totals, previous: range === 'all' ? null : prevTotals,
    deltas: range === 'all' ? { viewsPct: null, likesPct: null, commentsPct: null, sharesPct: null, savesPct: null, followerGrowthPct: null, revenuePct: null } : {
      viewsPct: delta(totals.views, prevTotals.views), likesPct: delta(totals.likes, prevTotals.likes), commentsPct: delta(totals.comments, prevTotals.comments),
      sharesPct: delta(totals.shares, prevTotals.shares), savesPct: delta(totals.saves, prevTotals.saves), followerGrowthPct: delta(totals.followerGrowth, prevTotals.followerGrowth), revenuePct: delta(totals.revenueCents, prevTotals.revenueCents),
    },
    buckets: iso.map((bucket, i) => ({ bucket, views: postViewsSeries[i], likes: likesSeries[i] })),
    byType: (['video', 'image', 'slideshow'] as const).map(type => { const rows = postRows.filter(x => x.type === type); return { type, posts: rows.length, views: sum(rows.map(x => x.views)) }; }),
    posts: postRows,
  };

  const followerSeries = curve(range, iso.length, 9 * scale / Math.max(1, iso.length / 8), rand);
  const gained = sum(followerSeries);
  const prevGained = Math.round(gained * prevFactor);
  const buyers = Math.max(12, purchases);
  const viewers = Math.max(60, Math.round(views * 0.62));
  const deviceSplit = [0.58, 0.27, 0.15];
  const audience: AudienceStats = {
    window, minGroupSize: 5,
    followers: { total: 4120 + gained, gained, previousGained: range === 'all' ? null : prevGained, gainedPct: range === 'all' ? null : delta(gained, prevGained) },
    buckets: iso.map((bucket, i) => ({ bucket, followers: followerSeries[i] })),
    buyers: { suppressed: false, total: buyers, new: Math.round(buyers * 0.71), returning: buyers - Math.round(buyers * 0.71) },
    viewers: { suppressed: false, total: viewers, new: Math.round(viewers * 0.79), returning: viewers - Math.round(viewers * 0.79) },
    topCountries: [{ country: 'US', people: Math.round(buyers * 0.66) }, { country: 'CA', people: Math.round(buyers * 0.14) }, { country: 'GB', people: Math.round(buyers * 0.1) }].filter(c => c.people >= 5),
    topRegions: [{ country: 'US', region: 'CA', people: Math.round(buyers * 0.24) }, { country: 'US', region: 'NY', people: Math.round(buyers * 0.18) }, { country: 'US', region: 'TX', people: Math.round(buyers * 0.11) }].filter(c => c.people >= 5),
    hiddenLocations: 3,
    devices: (['ios', 'android', 'web'] as const).map((device, i) => ({ device, visits: Math.round(views * deviceSplit[i]), sharePct: Math.round(deviceSplit[i] * 1000) / 10 })),
    deviceVisits: views,
  };

  const orders = Math.max(1, purchases);
  const adv = {
    orders, revenueCents, refundedCents: Math.round(revenueCents * 0.021), refundedOrders: Math.round(orders * 0.03), discountedOrders: Math.round(orders * 0.22),
    discountCents: Math.round(revenueCents * 0.04), threadOrders: Math.round(orders * 0.31), threadRevenueCents: Math.round(revenueCents * 0.29),
    buyers, units, visits: Math.round(views * 0.9), averageOrderCents: Math.round(revenueCents / orders), unitsPerOrder: Math.round((units / orders) * 100) / 100,
    conversionPct: pct(orders, Math.round(views * 0.9)) ?? 0, refundRatePct: pct(Math.round(orders * 0.03), orders) ?? 0,
  };
  const prevAdv = { ...adv, revenueCents: Math.round(adv.revenueCents * prevFactor), orders: Math.round(adv.orders * prevFactor), averageOrderCents: Math.round(adv.averageOrderCents * (0.9 + rand() * 0.2)), conversionPct: Math.round(adv.conversionPct * (0.8 + rand() * 0.3) * 10) / 10, refundRatePct: Math.round(adv.refundRatePct * 1.3 * 10) / 10 };
  const ordersSeries = purchasesSeries;
  const advanced: AdvancedStats = {
    window, totals: { ...adv, repeatBuyers: Math.round(buyers * 0.29), repeatBuyerPct: 29 },
    previous: range === 'all' ? null : prevAdv,
    deltas: range === 'all' ? { averageOrderPct: null, conversionPct: null, refundRatePct: null, revenuePct: null } : {
      averageOrderPct: delta(adv.averageOrderCents, prevAdv.averageOrderCents), conversionPct: delta(adv.conversionPct, prevAdv.conversionPct),
      refundRatePct: delta(adv.refundRatePct, prevAdv.refundRatePct), revenuePct: delta(adv.revenueCents, prevAdv.revenueCents),
    },
    channels: [{ channel: 'threads', orders: adv.threadOrders, revenueCents: adv.threadRevenueCents }, { channel: 'store', orders: orders - adv.threadOrders, revenueCents: revenueCents - adv.threadRevenueCents }],
    buckets: iso.map((bucket, i) => ({ bucket, orders: ordersSeries[i], revenueCents: ordersSeries[i] * adv.averageOrderCents, averageOrderCents: ordersSeries[i] > 0 ? adv.averageOrderCents : 0 })),
    topCustomers: [
      { name: 'Jordan Reyes', orders: 6, totalCents: 68400, lastOrderAt: new Date(now.getTime() - 2 * 864e5).toISOString() },
      { name: 'Priya Natarajan', orders: 4, totalCents: 51200, lastOrderAt: new Date(now.getTime() - 5 * 864e5).toISOString() },
      { name: 'Marcus Lee', orders: 3, totalCents: 39600, lastOrderAt: new Date(now.getTime() - 9 * 864e5).toISOString() },
      { name: 'Sofia Alvarez', orders: 3, totalCents: 29400, lastOrderAt: new Date(now.getTime() - 12 * 864e5).toISOString() },
      { name: 'Customer', orders: 2, totalCents: 19600, lastOrderAt: new Date(now.getTime() - 20 * 864e5).toISOString() },
    ],
  };

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const frac = Math.max(0.05, (now.getTime() - monthStart.getTime()) / (monthEnd.getTime() - monthStart.getTime()));
  const daysLeft = Math.max(0, Math.ceil((monthEnd.getTime() - now.getTime()) / 864e5));
  const goal = (id: string, metric: Goal['metric'], target: number, actual: number): Goal => {
    const projected = Math.round(actual / frac);
    const status: Goal['status'] = actual >= target ? 'achieved' : projected >= target ? 'on_track' : 'behind';
    return {
      id, metric, period: 'month', target, actual, window: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
      progressPct: Math.round((actual / target) * 1000) / 10, remaining: Math.max(0, target - actual), expectedToDate: Math.round(target * frac),
      projected, projectedPct: Math.round((projected / target) * 1000) / 10, daysLeft, status,
    };
  };
  const goals: Goal[] = [
    goal('g1', 'revenue', 1200000, Math.round(1200000 * frac * 1.08)),
    goal('g2', 'orders', 140, Math.round(140 * frac * 0.74)),
    goal('g3', 'followers', 300, Math.round(300 * frac * 1.4)),
  ];

  return { products, content, audience, advanced, goals };
}

type SplitEmpty = AudienceStats['buyers'];

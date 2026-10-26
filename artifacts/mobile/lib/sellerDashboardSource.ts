/**
 * Where the seller Home dashboard reads its data, behind one interface:
 *
 *  - apiDashboardSource(api): the signed-in seller's real endpoints.
 *  - previewDashboardSource(mode): the signed-out web preview
 *    (`?bt_preview=seller`), answering the SAME calls in the SAME shapes from
 *    the seeded demo store (lib/previewSellerOrders.ts and friends), using the
 *    server's own rules (paid, not cancelled; top products by line revenue).
 *
 * The dashboard has one code path over either source, so every number the
 * preview shows went through exactly the derivation a real seller's does
 * (lib/sellerDashboardStats.ts deriveDashboardSecondary, the hero/tile maths
 * in SellerHomeCommerceDashboard.tsx). Preview never touches the network.
 */
import type { SellerHomeAnalytics } from './sellerHomeAnalytics';
import type { SellerHomeTimeRange } from './sellerHomeChartLabels';
import type { NextPayoutEstimate, PayoutScheduleSummary } from './sellerDashboardHome';
import { optionalList } from './optionalList';

export interface DashboardFinanceBalance {
  available: { amount: number; currency: string; formatted: string };
  pending: { amount: number; currency: string; formatted: string };
  connected: boolean;
  payoutsEnabled?: boolean;
  bankConnected?: boolean;
  processingCashout?: { idempotencyKey: string; amount: number; currency: string; formatted: string } | null;
  /** Real next payout (Stripe's pending payout, or the schedule's next run). */
  nextPayoutEstimate?: NextPayoutEstimate | null;
  payoutSchedule?: PayoutScheduleSummary | null;
}

export interface SellerDashboardSource {
  kind: 'api' | 'preview';
  /** GET /api/analytics/home: hero, chart, stat tiles, traffic sources. */
  analyticsHome(range: SellerHomeTimeRange): Promise<SellerHomeAnalytics>;
  /** GET /api/orders, newest first. */
  orders(): Promise<any[]>;
  /** GET /api/analytics/products: paid, non-cancelled line revenue per product. */
  productAnalytics(): Promise<any[]>;
  /** The product catalog (thumbnails for Top products). */
  products(): Promise<Array<{ id?: string; images?: unknown }>>;
  /** The Products tab's own summary (its Low Stock chip count). */
  productStats(): Promise<{ lowStock: number }>;
  /** GET /api/returns (seller). Optional: [] on failure. */
  returns(): Promise<any[]>;
  /** Buyer conversations, as the seller inbox lists them. Optional: [] on failure. */
  conversations(): Promise<any[]>;
  /** Manufacturer hub (Growth-only threads 403 below that plan). Optional each. */
  quoteRequests(): Promise<any[]>;
  sampleOrders(): Promise<any[]>;
  manufacturerThreads(): Promise<any[]>;
  followers(): Promise<any[]>;
  reviews(): Promise<any[]>;
  financeBalance(): Promise<DashboardFinanceBalance>;
}

type Api = {
  analytics: { home: (range: SellerHomeTimeRange) => Promise<SellerHomeAnalytics>; products: () => Promise<any[]> };
  orders: { list: () => Promise<unknown> };
  products: { list: () => Promise<unknown> };
  returns: { listSeller: () => Promise<any[]> };
  sellerHub: { quoteRequests: { list: () => Promise<unknown> } };
  manufacturers: { sampleOrders: { list: () => Promise<unknown> }; threads: { list: () => Promise<unknown> } };
  social: { followers: () => Promise<unknown> };
  reviews: { mine: () => Promise<unknown> };
  finance: { balance: () => Promise<unknown> };
};

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export function apiDashboardSource(api: Api): SellerDashboardSource {
  return {
    kind: 'api',
    analyticsHome: (range) => api.analytics.home(range),
    orders: async () => asArray(await api.orders.list()),
    productAnalytics: async () => asArray(await api.analytics.products()),
    products: async () => asArray(await api.products.list()),
    productStats: async () => {
      const { getProductStats } = await import('@/services/productService');
      return getProductStats();
    },
    returns: () => optionalList(() => api.returns.listSeller()),
    conversations: async () => {
      const { getConversations } = await import('@/services/socialService');
      return optionalList(() => getConversations());
    },
    quoteRequests: () => optionalList(() => api.sellerHub.quoteRequests.list() as Promise<any[]>),
    sampleOrders: () => optionalList(() => api.manufacturers.sampleOrders.list() as Promise<any[]>),
    manufacturerThreads: () => optionalList(() => api.manufacturers.threads.list() as Promise<any[]>),
    followers: async () => asArray(await api.social.followers()),
    reviews: async () => asArray(await api.reviews.mine()),
    financeBalance: () => api.finance.balance() as Promise<DashboardFinanceBalance>,
  };
}

/** Line revenue per catalog product over paid, non-cancelled orders: the SQL in api-server routes/analytics.ts GET /products. */
export function previewProductAnalytics(
  orders: Array<{ paidAt: string | null; status: string; items: Array<{ productId: string; productName: string; quantity: number; priceCents: number }> }>,
  catalog: Array<{ id: string; name: string }>,
): Array<{ productId: string; name: string; imageUrl: null; revenueCents: number; unitsSold: number; orderCount: number }> {
  const rows = new Map(catalog.map((p) => [p.id, { productId: p.id, name: p.name, imageUrl: null, revenueCents: 0, unitsSold: 0, orderCount: 0 }]));
  for (const order of orders) {
    if (!order.paidAt || order.status === 'cancelled') continue;
    const seen = new Set<string>();
    for (const item of order.items ?? []) {
      const row = rows.get(item.productId);
      if (!row) continue;
      row.revenueCents += item.quantity * item.priceCents;
      row.unitsSold += item.quantity;
      if (!seen.has(item.productId)) { row.orderCount += 1; seen.add(item.productId); }
    }
  }
  return [...rows.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 20);
}

/** The demo store's next weekly payout: next Friday at noon. */
function nextFridayNoon(now: Date): string {
  const date = new Date(now);
  date.setDate(date.getDate() + (((5 - date.getDay()) + 7) % 7 || 7));
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

export function previewDashboardSource(mode: 'demo' | 'fresh', now: () => Date = () => new Date()): SellerDashboardSource {
  const demo = mode === 'demo';
  const empty = async () => [] as any[];
  const seededOrders = async () => {
    if (!demo) return [];
    const { allPreviewSellerOrders } = await import('./previewSellerOrders');
    return allPreviewSellerOrders(now());
  };
  const catalog = async () => {
    if (!demo) return [];
    const { getPreviewSellerProducts } = await import('./previewSellerProducts');
    return getPreviewSellerProducts();
  };
  return {
    kind: 'preview',
    analyticsHome: async (range) => {
      const { buildPreviewSellerAnalytics } = await import('./previewSellerChartData');
      return buildPreviewSellerAnalytics(range as Parameters<typeof buildPreviewSellerAnalytics>[0], mode, now());
    },
    orders: seededOrders,
    productAnalytics: async () => previewProductAnalytics(await seededOrders(), await catalog()),
    products: async () => (await catalog()).map((product) => ({
      id: product.id,
      images: [...product.media].sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder).map((m) => m.uri),
    })),
    productStats: async () => {
      if (!demo) return { lowStock: 0 };
      const { summarizeProducts } = await import('@/services/productService');
      return summarizeProducts(await catalog());
    },
    returns: empty,
    conversations: empty,
    quoteRequests: empty,
    sampleOrders: empty,
    manufacturerThreads: empty,
    followers: empty,
    reviews: empty,
    // Stripe balances are seeded (a preview has no Stripe account); fresh shows none.
    financeBalance: async () => ({
      available: demo ? { amount: 428122, currency: 'usd', formatted: '$4,281.22' } : { amount: 0, currency: 'usd', formatted: '$0.00' },
      pending: demo ? { amount: 184250, currency: 'usd', formatted: '$1,842.50' } : { amount: 0, currency: 'usd', formatted: '$0.00' },
      connected: demo,
      payoutsEnabled: demo,
      bankConnected: demo,
      processingCashout: null,
      ...(demo ? {
        nextPayoutEstimate: { kind: 'scheduled', date: nextFridayNoon(now()), amount: 428122, formatted: '$4,281.22' } as NextPayoutEstimate,
        payoutSchedule: { interval: 'weekly' } as PayoutScheduleSummary,
      } : {}),
    }),
  };
}

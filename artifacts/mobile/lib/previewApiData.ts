/**
 * Preview data layer for the signed-out guard in lib/api.ts.
 *
 * The dev web preview (`?bt_preview=seller|buyer`) has no account, so lib/api.ts
 * never sends it to a protected endpoint (lib/signedOutApiPolicy.ts). Instead a
 * protected GET is answered here, locally:
 *
 * - Fresh (default): exactly what the real API server returns for a brand-new
 *   account. Every body below was recorded from the server on origin/dev for a
 *   freshly onboarded seller/buyer, with only the ids, email and timestamps
 *   swapped for the preview account's. So a fresh preview screen renders the
 *   same honest empty state a new user sees — never sample data, never an
 *   "Unauthorized"/"Couldn't load" error.
 * - Demo (`&demo=1` only): the same shapes, filled from the existing preview
 *   fixtures (orders, products, profile) so every screen tells one story —
 *   Orders, Dashboard and Shipping all read the same seeded orders.
 *
 * A path with no entry here is not answered: lib/api.ts rejects it with a local
 * 401 (`auth_required`) and still never touches the network.
 *
 * Pure apart from the fixture modules it reads; the caller passes role/demo.
 */
import { getPreviewAccount, type PreviewAccount, type PreviewRole } from './previewAccount';
import { normalizeApiPath } from './signedOutApiPolicy';
import { getPreviewSellerOrders } from './previewOrders';

export interface PreviewApiContext {
  role: PreviewRole;
  demo: boolean;
  /** Injected so tests are deterministic. */
  now?: Date;
  /**
   * Demo only: the seeded seller catalog the Products tab shows
   * (lib/previewSellerProducts.ts), already in GET /api/products row shape.
   * Injected by lib/previewApiSession.ts so this module stays free of
   * bundled-asset imports.
   */
  demoProducts?: () => unknown[];
}

type Resolver = (ctx: Required<PreviewApiContext>, account: PreviewAccount) => unknown;

const money = (amount = 0) => ({ amount, currency: 'usd', formatted: `$${(amount / 100).toFixed(2)}` });

function authMe(ctx: Required<PreviewApiContext>, a: PreviewAccount) {
  const at = ctx.now.toISOString();
  return {
    id: a.id, clerkId: a.id, email: a.email, name: a.name, role: 'owner', avatarUrl: '',
    displayName: a.name, bio: a.bio || null, profileImageUrl: null, accountType: a.role,
    appThemeId: 'monochrome', appIconId: null, inviteCode: null, referredByCode: null,
    dmPrivacy: 'requests', buyerStyleInterests: [], brandName: a.role === 'seller' ? a.name : null,
    brandType: null, brandStage: null, sellModel: null, onboardingComplete: true,
    stripeAccountId: null, stripeAccountStatus: null, stripeCustomerId: null, subscriptionId: null,
    subscriptionStatus: 'none', subscriptionPeriodEnd: null, subscriptionPlanId: 'starter',
    subscriptionTrialStartedAt: null, subscriptionTrialEndsAt: null,
    subscriptionTrialBannerDismissedTrialEnd: null, feedGesturesTipSeenVersion: 0, verified: false,
    verificationStatus: 'unverified', stripeVerificationSessionId: null, activeStanding: true,
    policyRestricted: false, returnPolicy: null, cancellationPolicy: null, sellerShipFromCountry: 'US',
    website: a.website || null, category: a.category || null, tags: a.tags, location: a.location || null,
    socialLinks: socialLinks(a), contactEmail: a.contactEmail || null, logoUrl: null, bannerUrl: null,
    coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: null,
    coverVideoModerationStatus: 'visible', coverCoachmarkSeenAt: null, avatarVideoUrl: null,
    avatarPosterUrl: null, avatarVideoUpdatedAt: null, username: a.username, storefrontVisitCount: 0,
    vacationMode: false, vacationMessage: null, vacationUntil: null, notificationPreferences: {},
    notificationDigest: 'realtime', pushEnabled: true, quietHoursStart: null, quietHoursEnd: null,
    quietHoursTimezone: 'UTC', deletedAt: null, suspendedAt: null, suspensionReason: null,
    termsAcceptedAt: at, termsVersion: null, isSystemAccount: false, isReviewAccount: false,
    createdAt: at, updatedAt: at,
  };
}

function socialLinks(a: PreviewAccount): Record<string, string> {
  const links: Record<string, string> = {};
  if (a.instagram) links.instagram = a.instagram;
  if (a.tiktok) links.tiktok = a.tiktok;
  return links;
}

function sellerProfile(ctx: Required<PreviewApiContext>, a: PreviewAccount) {
  const orders = ctx.demo && a.role === 'seller' ? getPreviewSellerOrders() : [];
  const revenueCents = orders.reduce((sum, o) => sum + Number((o as { totalCents?: number }).totalCents ?? 0), 0);
  return {
    id: a.id, clerkId: a.id, displayName: a.name, brandName: a.role === 'seller' ? a.name : null,
    bio: a.bio || null, website: a.website || null, coverVideoUrl: null, coverPosterUrl: null,
    avatarVideoUrl: null, avatarPosterUrl: null, username: a.username, profileImageUrl: '', avatarUrl: '',
    logoUrl: null, bannerUrl: null, category: a.category || null, tags: a.tags, location: a.location || null,
    socialLinks: socialLinks(a), contactEmail: a.contactEmail || null, storefrontVisits: 0, verified: false,
    verificationStatus: 'unverified', returnPolicy: null, cancellationPolicy: null,
    subscriptionStatus: 'none', subscriptionPlanId: 'starter', totalLikes: 0,
    metrics: { revenueCents, visitors: 0, orders: orders.length, conversionRate: 0 },
  };
}

function store(ctx: Required<PreviewApiContext>, a: PreviewAccount) {
  const at = ctx.now.toISOString();
  return {
    id: `${a.id}-store`, ownerId: a.id, slug: a.username.replace(/_/g, '-'),
    title: ctx.demo ? a.name : 'My Store', subtitle: null, description: ctx.demo ? a.bio : null,
    status: ctx.demo ? 'published' : 'draft',
    theme: {
      themeId: 'thread', primaryColor: '#000000', secondaryColor: '#C0C0C0', accentColor: '#000000',
      backgroundColor: '#FFFFFF', textColor: '#000000', fontFamily: "'Inter', system-ui, sans-serif", borderRadius: 0,
    },
    branding: { tagline: '', logoUrl: '', targetAudience: '' },
    sections: [
      { id: 'thread-hero', type: 'hero_image', title: 'Hero Image', enabled: true, settings: { heading: 'The new uniform.', description: 'Considered pieces for everyday movement.', buttonLabel: 'Shop the collection', fullWidth: true, sectionHeight: 'tall' } },
      { id: 'thread-products', type: 'product_grid', title: 'Product Grid', enabled: true, settings: { heading: 'Current collection', description: 'The pieces in rotation.', columns: 2, quickAdd: false } },
      { id: 'thread-story', type: 'brand_story', title: 'Brand Story', enabled: true, settings: { heading: 'Designed with intention.', description: 'Fewer pieces, better made, and meant to be worn often.' } },
      { id: 'thread-newsletter', type: 'newsletter', title: 'Newsletter', enabled: true, settings: { heading: 'Stay close.', description: 'New releases, studio notes, and first access.', buttonLabel: 'Join the list' } },
    ],
    seo: {}, socialLinks: socialLinks(a), analyticsCode: null, publishedAt: ctx.demo ? at : null,
    sharePreviewRevokedAt: null, sharePreviewTokenHash: null, createdAt: at, updatedAt: at,
  };
}

const SELLER_WILL_DELETE = [
  'Your profile, username, photo and bio',
  'Posts, comments, stories, likes, reposts and follows',
  'Direct messages you sent',
  'Saved items, cart, addresses and notification settings',
  'Your storefront, product listings, discount codes and shipping settings',
  'Payout and subscription links to Stripe',
  "Your sign-in (you'll be signed out on every device)",
];
const BUYER_WILL_DELETE = [
  'Your profile, username, photo and bio',
  'Posts, comments, stories, likes, reposts and follows',
  'Direct messages you sent',
  'Saved items, cart, addresses and notification settings',
  "Your sign-in (you'll be signed out on every device)",
];
const WILL_RETAIN = [
  'Order, payment, refund and tax records, with your name and address removed — kept as long as the law requires',
  "Reports you made about other people's content, without your identity",
];

const sizes = (rows: Array<[string, string[]]>) => rows.map(([size, values]) => ({ size, values }));
/** The size-chart presets #646's server ships (lib/sizeChart.ts SIZE_CHART_PRESETS). */
const SIZE_CHART_PRESETS = [
  { key: 'tops', name: 'Tops & tees', chart: { unit: 'inches', columns: ['Chest', 'Length', 'Sleeve'], rows: sizes([
    ['XS', ['32-34', '25', '7.5']], ['S', ['35-37', '26', '8']], ['M', ['38-40', '27', '8.5']],
    ['L', ['41-43', '28', '9']], ['XL', ['44-46', '29', '9.5']], ['XXL', ['47-49', '30', '10']]]) } },
  { key: 'bottoms', name: 'Pants & shorts', chart: { unit: 'inches', columns: ['Waist', 'Hip', 'Inseam'], rows: sizes([
    ['XS', ['26-28', '34-36', '30']], ['S', ['29-31', '37-39', '30']], ['M', ['32-34', '40-42', '31']],
    ['L', ['35-37', '43-45', '31']], ['XL', ['38-40', '46-48', '32']], ['XXL', ['41-43', '49-51', '32']]]) } },
  { key: 'dresses', name: 'Dresses', chart: { unit: 'inches', columns: ['Bust', 'Waist', 'Hip', 'Length'], rows: sizes([
    ['XS', ['32', '25', '35', '38']], ['S', ['34', '27', '37', '39']], ['M', ['36', '29', '39', '40']],
    ['L', ['38', '31', '41', '41']], ['XL', ['41', '34', '44', '42']]]) } },
  { key: 'hats', name: 'Hats & beanies', chart: { unit: 'inches', columns: ['Head circumference'], rows: sizes([
    ['S/M', ['21-22']], ['L/XL', ['22.5-24']]]) } },
];

const TEAM_ROLES = [
  { key: 'owner', name: 'Owner', group: 'Organization', description: 'Full access to all features including billing, payouts, and team management', permissions: ['*'] },
  { key: 'admin', name: 'Admin', group: 'Organization', description: 'Manage products, orders, inventory, analytics, customers, marketing, payouts and the team', permissions: ['products', 'orders', 'inventory', 'analytics', 'customers', 'marketing', 'payouts', 'team'] },
  { key: 'finance', name: 'Finance', group: 'Store', description: 'View balance, payouts, transactions and statements', permissions: ['payouts', 'analytics'] },
  { key: 'orders', name: 'Orders', group: 'Store', description: 'Manage orders, fulfillment and inventory', permissions: ['orders', 'inventory'] },
  { key: 'marketing', name: 'Marketing', group: 'Store', description: 'Manage ads, boosts and discount codes', permissions: ['marketing', 'analytics'] },
  { key: 'viewer', name: 'Viewer', group: 'Store', description: 'Read-only access to analytics and store data', permissions: ['analytics'] },
];

/** Normalized path (see normalizeApiPath) → response. Query strings are ignored. */
const RESOLVERS: Record<string, Resolver> = {
  // ── Account (both roles) ────────────────────────────────────────────────
  'auth/me': authMe,
  'auth/account/deletion-check': (_c, a) => ({
    canDelete: true,
    accountType: a.role,
    blockers: [],
    willDelete: a.role === 'seller' ? SELLER_WILL_DELETE : BUYER_WILL_DELETE,
    willRetain: a.role === 'seller'
      ? [...WILL_RETAIN, 'Reviews buyers left on past orders, shown as from a deleted account']
      : WILL_RETAIN,
  }),
  'auth/feed-gestures-tip': () => ({ seenVersion: 0 }),
  'auth/privacy': () => ({ dmPrivacy: 'requests' }),
  'auth/sessions': () => ({ sessions: [] }),
  'moderation/me': () => ({ isModerator: false }),
  'safety/muted-words': () => ({ words: [], limit: 200 }),
  'social/blocks': () => [],
  'social/following': () => [],
  'social/followers': () => [],
  'public/search/recent': () => ({ recent: [] }),
  'referrals/stats': () => ({ total: 0, pointsEarned: 0, referrals: [] }),
  'freelancers/me': () => ({ freelancer: null }),
  'buyer/notifications': () => [],
  'buyer/notifications/unread-count': () => ({ count: 0 }),
  'social/suggested': () => [],
  'team/context': (_c, a) => ({ role: 'owner', storeOwnerId: a.id, teamMembershipId: null }),

  // ── Seller account & settings ──────────────────────────────────────────
  'seller/profile': sellerProfile,
  // Demo: the seller already takes payments (it has paid orders); fresh: not started.
  'seller/connect/status': (ctx) => (ctx.demo
    ? {
      connected: true, stripeAccountId: null, chargesEnabled: true, payoutsEnabled: true,
      detailsSubmitted: true, status: 'active', verified: true, bankLast4: '4242',
      providerConfigured: true, payoutSchedule: null, requirementsDue: [], taxInfoStatus: 'submitted',
    }
    : {
      connected: false, stripeAccountId: null, chargesEnabled: false, payoutsEnabled: false,
      detailsSubmitted: false, status: 'not_started', verified: false, bankLast4: null,
      providerConfigured: false, payoutSchedule: null, requirementsDue: [], taxInfoStatus: 'unknown',
    }),
  'seller/subscription/status': () => ({
    plan: 'starter', status: 'none', renewsOn: null, trialEnd: null, trialStartAt: null, trialEndAt: null,
    trialBanner: null, amountCents: 0, paymentMethodLabel: null, effectiveProvider: 'none', native: null,
  }),
  'seller/subscription/invoices': () => ({ invoices: [] }),
  'seller/verification/status': () => ({ verified: false, verificationStatus: 'unverified', sessionId: null }),
  'seller/vacation': () => ({ vacationMode: false, vacationMessage: null, vacationUntil: null }),
  'seller/settings': () => ({ settings: {} }),
  'seller/settings/policies': () => ({ policies: [] }),
  'seller/settings/integrations': () => ({ integrations: [] }),
  'seller/locations': () => ({ locations: [] }),
  'seller/metafields': () => ({ counts: {} }),
  'integrations/klaviyo': () => ({ connected: false }),
  'shopify/status': () => ({ connected: false, fulfillmentEnabled: false, linkedProductsCount: 0 }),
  'shopify-imports/latest': () => null,
  'taxes/status': () => ({
    stripeTaxEnabled: false, provider: 'stripe_tax', providerConfigured: false, providerStatus: 'not_configured',
    automaticTaxAtCheckout: true,
    complianceNote: 'Stripe calculates tax when an applicable registration and destination are configured. This setting is not a nexus determination or filing registration.',
    collectDuties: false, chargeShippingTax: false, chargeVat: false, taxCalculationMode: 'automatic', stripeSettings: null,
  }),
  'team/members': (ctx, a) => [{
    id: 'owner', email: a.email, name: a.name, role: 'owner', status: 'active', invitedAt: null,
    joinedAt: ctx.now.toISOString(), lastActiveAt: null, memberClerkId: a.id, online: true, isOwner: true,
  }],
  'team/roles': () => TEAM_ROLES.map((role) => ({ ...role, staffCount: role.key === 'owner' ? 1 : 0, pendingCount: 0 })),
  'team/activity': () => ({ logs: [], hasMore: false, nextOffset: 0 }),

  // ── Store & catalog ────────────────────────────────────────────────────
  'store': store,
  'store/versions': () => [],
  'store/domains': () => [],
  'products': (ctx, a) => (ctx.demo && a.role === 'seller' ? ctx.demoProducts() : []),
  'bundles': () => [],
  'drops': () => [],
  'discount-codes': () => [],
  'waitlist/seller': () => [],

  // ── Orders & fulfilment ────────────────────────────────────────────────
  // Demo: the same seeded orders the Orders tab renders (lib/previewOrders.ts),
  // so Orders, Shipping and anything else listing orders agree.
  'orders': (ctx, a) => (ctx.demo && a.role === 'seller' ? getPreviewSellerOrders() : []),
  'inventory': () => [],
  'sample-orders': () => [],
  'seller-hub/quote-requests': () => [],
  'manufacturers/threads': () => [],
  'analytics/products': () => [],
  'customers': () => [],
  'seller-hub/rfqs': () => [],
  'seller-hub/manufacturers': () => [],
  'thread-cash/history': () => ({ history: [] }),
  'returns': () => [],
  'disputes': () => [],
  'shipping-rates': () => [],
  'shipping-zones': () => [],
  'shipping-zones/settings': () => ({ shipFromCountry: 'US' }),

  // ── Money (no Stripe account in a preview — same as a new seller) ───────
  'finance/balance': () => ({ available: money(), pending: money(), nextPayout: null, connected: false }),
  'finance/summary': () => ({
    currency: 'usd', connected: false, stripeError: false,
    held: { ...money(), drops: [] }, releasing: { ...money(), count: 0 },
    available: null, pending: null, paidOut: { ...money(), toBank: null }, owed: money(), credit: money(),
    lifetime: { grossSales: money(), refunded: money(), platformFees: money(), processingFees: money() },
    activity: [],
  }),
  'finance/transactions': () => ({ transactions: [], connected: false }),
  'finance/payouts': () => ({ payouts: [], connected: false }),

  // ── Endpoints added by open PRs (answered here so those screens render the
  // fresh state in the preview as soon as they land). Bodies are what each
  // PR's server returns for a new seller with no keys configured. ───────────
  'marketing/email/status': () => ({
    enabled: false, provider: null, message: "Email sending isn't set up yet. Drafts are saved and nothing is sent.",
    dailyCap: 1000, sentToday: 0, remainingToday: 1000,
    tracking: { delivered: false, opened: false, clicked: false }, missing: ['mailing_address'],
  }), // #634
  'marketing/email/audience': () => ({ counts: { subscribers: 0, customers: 0, followers: 0 }, byStatus: {}, subscribers: [], hasMore: false }), // #634
  'marketing/email/campaigns': () => ({ campaigns: [] }), // #634
  'seller/push-broadcasts': () => ({
    canSendNow: true, nextSendAt: null, limits: { titleMax: 50, bodyMax: 178 },
    audience: { followers: 0, recipients: 0 }, history: [],
  }), // #660
  'seller/giveaways': () => ({ giveaways: [] }), // #660
  'posts/mine': () => [], // #660
  'size-chart-templates': () => ({ templates: [], presets: SIZE_CHART_PRESETS }), // #646
  'seller/launch-checklist': (_c, a) => ({
    steps: ['name_handle', 'logo_banner', 'accent', 'socials', 'first_product', 'preview', 'publish', 'payouts']
      .map((id) => ({ id, done: id === 'name_handle' })),
    doneCount: 1, total: 8, complete: false, handle: a.username, dismissed: false,
  }), // #649
  'live/cohost-invites': () => ({ invites: [] }), // #628
  'seller/affiliate': (_c, a) => ({
    program: { enabled: false, commissionPercent: 10, buyerDiscountPercent: 0, windowDays: 30, holdDays: 30, minPayoutCents: 2500, autoApprove: false },
    creators: [],
    totals: { clicks: 0, orders: 0, revenueCents: 0, earnedCents: 0, pendingCents: 0, payableCents: 0, paidCents: 0 },
    programLink: `https://brandthread.app/creator-program/join?brand=${encodeURIComponent(a.username)}`,
    payoutsAvailable: false,
  }), // #610
  'gift-cards/seller/settings': (_c, a) => ({
    sellerId: a.id, enabled: false, denominations: [2500, 5000, 10000], allowCustom: false, expiryMonths: null, minCents: 500, maxCents: 100000,
  }), // #635
  'gift-cards/store': (_c, a) => ({
    sellerId: a.id, storeName: a.name, enabled: false, denominations: [], allowCustom: false, minCents: 500, maxCents: 100000,
  }), // #635 (called with the preview's empty seller id)
  'gift-cards/mine': () => ({ cards: [], totalCents: 0 }), // #635
  'finance/payout-schedule': () => ({
    connected: false, providerConfigured: false, payoutsEnabled: false, schedule: null,
    instant: { eligible: false, reason: 'not_connected', destination: null, feeBps: 100, minFeeCents: 50, maxAmount: null, quote: null },
    nextPayoutEstimate: null,
  }), // #631
  'finance/statements': () => ({ connected: false, months: [] }), // #596
  'product-qa/seller': () => ({ unansweredCount: 0, questions: [] }), // #657
  'sales': () => [], // #602
  'sales/collections': () => [], // #602
  'discount-codes/collections': () => [], // #617
  'social/follow-requests': () => [], // #637
};

export type PreviewApiHit = { data: unknown };

/** The local answer for a protected GET in the preview, or null when there is none. */
export function resolvePreviewApiResponse(path: string, ctx: PreviewApiContext): PreviewApiHit | null {
  const resolver = RESOLVERS[normalizeApiPath(path)];
  if (!resolver) return null;
  const full: Required<PreviewApiContext> = { ...ctx, now: ctx.now ?? new Date(), demoProducts: ctx.demoProducts ?? (() => []) };
  return { data: resolver(full, getPreviewAccount(ctx.role, ctx.demo)) };
}

/** Exposed for tests/diagnostics: every path the preview answers locally. */
export function previewApiPaths(): string[] {
  return Object.keys(RESOLVERS);
}

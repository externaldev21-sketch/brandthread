import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'),
  'utf8',
);

describe('seller home dashboard data contract', () => {
  it('waits for the authenticated seller and reloads analytics when the range changes', () => {
    expect(source).toContain('if (sellerPreview)');
    expect(source).toContain('[analyticsUserId, api, range, retryTick, sellerPreview, storeContextTick]');
    // analyticsUserId = the signed-in user, or a fixed id in the dev preview (which has no account).
    expect(source).toContain('sellerHomeAnalyticsKey(analyticsUserId, range)');
    expect(source).toContain('const analyticsUserId = sellerPreview ? userId ?? PREVIEW_ANALYTICS_USER : userId');
    expect(source).toContain('allPreviewSellerOrders()');
    expect(source).toContain('setSnapshot({ key: requestKey');
  });

  it('shows a real retry banner instead of a fabricated zero state on failure', () => {
    // A fetch failure must never render as if it were real data (e.g. a
    // false "$0.00 · All caught up") — it shows an inline retry banner and
    // never substitutes zeros for a network error.
    expect(source).toContain('analyticsError');
    expect(source).toContain("Couldn’t load your dashboard.");
    expect(source).toContain('testID="seller-dashboard-error"');
    expect(source).toContain('accessibilityLabel="Retry loading the dashboard"');
  });

  it('leads with one hero number and a real, non-fabricated delta line', () => {
    expect(source).toContain('testID="seller-dashboard-hero-value"');
    expect(source).toContain('describeDashboardDelta(metricAggregate.current, metricAggregate.previous');
    // No delta is shown for the "all" range, since there is no meaningful
    // previous all-time period to compare against.
    expect(source).toContain("range !== 'all' && periodLabel");
  });

  it('never shows the delta line before the animated hero number has caught up to it', () => {
    // Reported bug: the hero read $0.00 while the delta line (computed
    // instantly from metricAggregate, not animated) already showed a real
    // "+$162.57 (16.4%)" — they can only ever disagree while the hero's
    // count-up animation is still catching up to the same metricAggregate
    // value the delta was computed from.
    expect(source).toContain('const heroSettled = heroDisplay === Math.round(activeValue)');
    expect(source).toContain('deltaLine && scrubIndex === null && heroSettled');
  });

  it('the hero, delta and chart all read the same range-scoped data — no separate period source', () => {
    // metricAggregate (hero + delta), the chart's series/labels, and the
    // stat tiles all derive from the same `data`/`buckets`, which is itself
    // gated to the currently selected `range` by selectSellerHomeAnalytics
    // — there is no second, independently-fetched period anywhere here.
    // EMPTY_BUCKETS is a stable module-level `[]` reused here instead of an
    // inline `?? []` literal — a fresh array every render was feeding a
    // useMemo dependency below and defeating its memoization (same bug
    // class, though not itself infinite, as app/boost.tsx's "Maximum
    // update depth exceeded" crash — see that fix's own comments).
    expect(source).toContain('const buckets = data?.buckets ?? EMPTY_BUCKETS');
    expect(source).toContain('metricSeries(metric, buckets)');
    expect(source).toContain('bucketLabel(b.bucket, range as SellerHomeTimeRange)');
    expect(source).toMatch(/case 'sales': return \{ current: data\.totalCents, previous: previous\.totalCents \}/);
  });

  it('renders a scrubbable chart wired to haptic feedback, not a static bar chart', () => {
    expect(source).toContain('<SellerDashboardChart');
    expect(source).toContain('onScrub={setScrubIndex}');
  });

  it('gives every stat tile a real value and a real period-over-period delta, never a fabricated one', () => {
    expect(source).toContain("['orders', 'visitors', 'conversion', 'aov']");
    expect(source).toContain('compactDelta(agg.current, agg.previous)');
    expect(source).not.toContain('styles.statGrid');
  });

  it('always opens on Today, never a persisted or Week default', () => {
    expect(source).toContain("useState<SellerDashboardRange>('today')");
    expect(source).not.toContain("useState<SellerDashboardRange>('week')");
  });

  it('shows the empty-sales message once (in the chart) and hides the flat "—" delta on stat tiles', () => {
    expect(source).not.toContain(">{EMPTY_CHART_MESSAGE[range]}<");
    expect(source).toContain('emptyMessage={EMPTY_CHART_MESSAGE[range]}');
    expect(source).toContain("return { direction: 'flat', label: '' }");
  });

  it('hides action-needed/top-products/recent-orders and shows the setup card for a brand-new seller', () => {
    expect(source).toContain('const newSeller = everSoldCount !== null && isNewSeller(everSoldCount)');
    expect(source).toContain('newSeller ? (');
    expect(source).toContain('<SellerDashboardSetupCard');
    // Every other real-activity section is explicitly gated on !newSeller —
    // never shown alongside zeroed/fabricated data for a brand-new seller.
    expect(source).toContain('{!newSeller && (');
    expect(source).toContain('{!newSeller && topProducts && topProducts.length > 0 && (');
    expect(source).toContain('{!newSeller && recentOrders && recentOrders.length > 0 && (');
  });

  it('renders a flat baseline chart (never fabricated activity) for a brand-new seller', () => {
    expect(source).toContain('const isEmptyChart = newSeller ||');
  });

  it('confirms and idempotently requests a real owner-only cash out', () => {
    expect(source).toContain("currentRole !== 'owner'");
    expect(source).toContain("${processingCashout ? 'Finish cash out' : 'Cash out'} ${formattedAmount}?");
    expect(source).toContain('const payout = await api.finance.payout({');
    expect(source).toContain('amount,');
    expect(source).toContain('currency,');
    expect(source).toContain('payoutAttemptKeyRef.current');
    expect(source).toContain('AsyncStorage.setItem(storageKey');
    expect(source).toContain('subscribeStoreContext');
    expect(source).toContain('accessibilityLabel="Withdraw available balance"');
  });

  it('refetches analytics/orders/products — not just the finance balance — when the seller switches stores', () => {
    // Regression test: switching between a seller's own store and a joined
    // store (same signed-in account) used to leave the dashboard showing the
    // previously active store's numbers, because only loadFinanceBalance
    // reacted to subscribeStoreContext.
    expect(source).toContain('[analyticsUserId, api, range, retryTick, sellerPreview, storeContextTick]');
    expect(source).toContain('[loadSecondaryData, retryTick, storeContextTick]');
    // The stale snapshot/top-products/recent-orders must be dropped
    // immediately on a store switch, not left on screen until the refetch
    // resolves.
    expect(source).toMatch(/setSnapshot\(null\);[\s\S]{0,80}setTopProducts\(null\);[\s\S]{0,80}setRecentOrders\(null\);[\s\S]{0,80}setStoreContextTick/);
  });

  it('supports pull-to-refresh instead of only an initial load', () => {
    expect(source).toContain('<RefreshControl');
    expect(source).toContain('refreshing={refreshing}');
    expect(source).toContain('onRefresh={onRefresh}');
  });
});

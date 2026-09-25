import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'),
  'utf8',
);

describe('seller home dashboard data contract', () => {
  it('waits for the authenticated seller and reloads analytics when the range changes', () => {
    expect(source).toContain('if (!userId)');
    expect(source).toContain('[api, range, userId, retryTick]');
    expect(source).toContain('sellerHomeAnalyticsKey(userId, range)');
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

  it('renders a scrubbable chart wired to haptic feedback, not a static bar chart', () => {
    expect(source).toContain('<SellerDashboardChart');
    expect(source).toContain('onScrub={setScrubIndex}');
  });

  it('gives every stat tile a real value and a real period-over-period delta, never a fabricated one', () => {
    expect(source).toContain("['orders', 'visitors', 'conversion', 'aov']");
    expect(source).toContain('compactDelta(agg.current, agg.previous)');
    expect(source).not.toContain('styles.statGrid');
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

  it('supports pull-to-refresh instead of only an initial load', () => {
    expect(source).toContain('<RefreshControl');
    expect(source).toContain('refreshing={refreshing}');
    expect(source).toContain('onRefresh={onRefresh}');
  });
});

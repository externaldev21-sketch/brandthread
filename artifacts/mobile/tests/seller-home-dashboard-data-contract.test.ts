import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'),
  'utf8',
);

describe('seller home dashboard data contract', () => {
  it('waits for the authenticated seller and reloads when that identity becomes ready', () => {
    expect(source).toContain('if (!userId)');
    expect(source).toContain('[api, range, userId]');
    expect(source).toContain('sellerHomeAnalyticsKey(userId, range)');
    expect(source).toContain('setSnapshot({ key: requestKey');
  });

  it('shows a real error banner instead of a fabricated zero state on failure', () => {
    // A fetch failure must never render as if it were real data (e.g. a
    // false "$0.00 · All caught up") — see docs/polish/punch-list.md,
    // SellerHomeCommerceDashboard. It shows an inline retry banner and
    // keeps/clears the tiles honestly instead of substituting zeros.
    expect(source).toContain('analyticsError');
    expect(source).toContain("Couldn’t load your sales. Pull to refresh.");
    expect(source).toContain("Couldn’t refresh your sales. Pull to refresh.");
  });

  it('uses the Dashboard title and a swipeable metric carousel instead of a KPI grid', () => {
    expect(source).toMatch(/<Text style=\{\[styles\.screenTitle,[\s\S]*?\}>Dashboard<\/Text>/);
    expect(source).toContain('<SellerMetricCarousel');
    expect(source).not.toContain('styles.statGrid');
    expect(source).not.toContain("width: '48%'");
  });

  it('gives every metric page real data: a value, and (except balances) a real previous-period comparison and sparkline', () => {
    expect(source).toContain("label: 'Total sales'");
    expect(source).toContain('previousValue: data.previous.totalCents');
    expect(source).toContain('spark: data.buckets.map((b) => b.totalCents)');
    expect(source).toContain("label: 'Orders'");
    expect(source).toContain('previousValue: data.previous.orderCount');
    expect(source).toContain("label: 'Available balance'");
    expect(source).toContain("label: 'Pending balance'");
    // Balances are a snapshot, not a period sum — no fabricated comparison or sparkline.
    const availablePage = source.slice(source.indexOf("key: 'available'"), source.indexOf("key: 'pending'"));
    expect(availablePage).not.toContain('previousValue');
    expect(availablePage).not.toContain('spark:');
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
});
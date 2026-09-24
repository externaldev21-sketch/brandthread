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

  it('shows an honest zero state instead of a blocking retry error', () => {
    expect(source).toContain('zeroSellerHomeAnalytics(range)');
    expect(source).not.toContain('Could not load dashboard');
    expect(source).not.toContain('Tap to retry');
  });

  it('uses the Dashboard title and an even KPI tile grid that scales large values', () => {
    expect(source).toMatch(/<Text style=\{\[styles\.screenTitle,[\s\S]*?\}>Dashboard<\/Text>/);
    expect(source).toContain("flexWrap: 'wrap'");
    expect(source).toContain("width: '48%'");
    expect(source.match(/adjustsFontSizeToFit/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/numberOfLines=\{1\}/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('shows pending and cash-outable balances as inline rows under Visitors', () => {
    expect(source).toContain('Pending Balance');
    expect(source).toContain('Available Balance');
    expect(source).toContain('styles.balanceLine');
    expect(source).not.toContain('View full analytics');
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
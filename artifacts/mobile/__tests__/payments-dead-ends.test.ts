/**
 * Source-level guards for audit dead ends fixed in the seller money screens
 * and the creator payout return (items 3, 12, 13, 14, 151).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('finance statement download (item 14)', () => {
  const finance = read('app/finance.tsx');
  it('fetches the CSV with the seller session instead of opening an unauthenticated URL', () => {
    expect(finance).toContain('await fetchStatementCsv({');
    expect(finance).toContain('token: await getToken()');
    expect(finance).toContain('headers: storeContextHeaders()');
    expect(finance).toContain('saveCsvFile(');
    expect(finance).not.toContain('Linking.openURL(url)');
  });
  it('shows a real error instead of failing silently', () => {
    expect(finance).toContain('setStatementError(statementErrorLabel(err))');
    expect(finance).toContain('<RetryRow label={statementError}');
    expect(finance).not.toContain('/* ignore */');
  });
  it('exposes an authenticated text fetch for the statement', () => {
    expect(read('lib/api.ts')).toContain("statementCsv: () => getText('/api/finance/statement.csv')");
  });
});

describe('buy now, pay later seller setting (items 13, 151)', () => {
  const payments = read('app/payments.tsx');
  it('shows a retry row when the setting fails to load instead of hiding it', () => {
    expect(payments).toContain('setBnplLoadError(true)');
    expect(payments).toContain('<RetryRow label="Couldn\'t load buy now, pay later settings" onRetry={loadBnpl} />');
  });
  it('tells sellers BNPL is web-only today', () => {
    expect(payments).toContain('not yet in the iPhone or Android app');
  });
});

describe('Thread Cash wallet copy (item 12)', () => {
  it('does not promise spending while checkout redemption is off', () => {
    const screen = read('app/thread-cash.tsx');
    expect(screen).toContain("useFeatureFlag('threadCashCheckoutDiscount')");
    expect(screen).toContain('Spending it at checkout is coming soon');
  });
});

describe('creator payout return (item 3)', () => {
  it('handles the ?payouts= return from Stripe onboarding', () => {
    const screen = read('app/creator-program.tsx');
    expect(screen).toContain("payoutsReturn === 'refresh'");
    expect(screen).toContain("payoutsReturn === 'returned'");
  });
});

/**
 * Seller Thread Cash: Payouts card + cash-out sheet, the History screen,
 * and the small balance rows on the dashboard and the More/Payouts tile —
 * all wired to the one shared hook (useSellerThreadCashBalance /
 * useSellerThreadCashHistory) so the numbers can never drift between them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('Payouts screen: Thread Cash card + cash-out sheet', () => {
  const source = read('app/payouts.tsx');
  it('renders the Thread Cash card near the top, above the Stripe balance hero', () => {
    const cardIdx = source.indexOf('<SellerThreadCashCard');
    const heroIdx = source.indexOf('Balance hero');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeLessThan(heroIdx);
  });
  it('wires the shared balance hook, not a screen-local fetch', () => {
    expect(source).toContain("useSellerThreadCashBalance");
  });
  it('renders the cash-out sheet and refreshes both balances on success', () => {
    expect(source).toContain('<CashOutSheet');
    expect(source).toContain('threadCash.reload()');
    expect(source).toContain('void load();'); // Stripe balance too — cash-out is a real transfer
  });
});

describe('Thread Cash history screen', () => {
  const source = read('app/thread-cash-history.tsx');
  it('uses the standard ScreenHeader', () => {
    expect(source).toContain('<ScreenHeader title="Thread Cash history"');
  });
  it('uses the shared layout EmptyState when there is no history', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bEmptyState\b[^}]*\}\s*from\s*['"]@\/components\/layout['"]/);
    expect(source).toContain('<EmptyState');
  });
  it('computes and renders a running balance per row', () => {
    expect(source).toContain('balanceAfter');
    expect(source).toContain('runningBalance');
  });
  it('is registered as a route', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('name="thread-cash-history"');
  });
});

describe('Seller dashboard earnings area', () => {
  it('shows a small Thread Cash row that links to Payouts', () => {
    const source = read('components/SellerHomeCommerceDashboard.tsx');
    expect(source).toContain('seller-dashboard-thread-cash-row');
    expect(source).toContain("nav('/payouts')");
    expect(source).toContain('useSellerThreadCashBalance');
  });
});

describe('Studio/More Payouts tile', () => {
  it('shows the live Thread Cash balance in the Payouts row description', () => {
    const source = read('app/(tabs)/more.tsx');
    expect(source).toContain('useSellerThreadCashBalance');
    expect(source).toContain("item.label === 'Payouts'");
    expect(source).toContain('Thread Cash');
  });
});

describe('Fresh vs demo: no fake data without &demo=1', () => {
  it('the shared hooks only fall back to the preview fixture, never unconditionally', () => {
    const source = read('hooks/useSellerThreadCash.ts');
    expect(source).toContain('isSellerDevPreview()');
    expect(source).toContain('getPreviewSellerThreadCashBalanceCents');
  });
  it('the preview fixture itself gates the seeded numbers behind demo mode', () => {
    const source = read('lib/previewSellerThreadCash.ts');
    expect(source).toContain('isPreviewDemoMode()');
    expect(source).toMatch(/isPreviewDemoMode\(\)\s*\?\s*PREVIEW_SELLER_THREAD_CASH_BALANCE_CENTS\s*:\s*0/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getPreviewFinanceDemo } from '../lib/previewFinance';

describe('seller demo products and finance fixtures', () => {
  it('provides five typed product fixture entries for local-only browsing', () => {
    const root = resolve(__dirname, '..');
    const fixture = readFileSync(resolve(root, 'lib/previewSellerProducts.ts'), 'utf8');
    const productList = fixture.slice(fixture.indexOf('export function getPreviewSellerProducts'));
    expect(productList.match(/buildProduct\(\{/g) ?? []).toHaveLength(5);
    expect(fixture).toContain("const id = `preview-product-${opts.index}`;");
    expect(fixture).toContain('function buildProduct(opts:');
  });

  it('derives a nonzero finance ledger from demo orders without claiming Stripe or bank readiness', () => {
    const { summary, transactions } = getPreviewFinanceDemo();
    expect(transactions.length).toBeGreaterThan(0);
    expect(summary.lifetime.grossSales.amount).toBeGreaterThan(0);
    expect(summary.activity.length).toBeGreaterThan(0);
    expect(summary.connected).toBe(false);
    expect(summary.available).toBeNull();
    expect(summary.pending).toBeNull();
    expect(summary.paidOut.amount).toBe(0);
    expect(summary.paidOut.toBank).toBeNull();
  });

  it('routes demo mode to local fixtures before signed-out empty fallbacks', () => {
    const root = resolve(__dirname, '..');
    const productsScreen = readFileSync(resolve(root, 'app/(tabs)/products.tsx'), 'utf8');
    const financeScreen = readFileSync(resolve(root, 'app/finance.tsx'), 'utf8');

    expect(productsScreen).toContain('const previewDemo = sellerPreview && isPreviewDemoMode();');
    expect(productsScreen.indexOf('if (previewDemo) {')).toBeLessThan(
      productsScreen.indexOf('if (previewOnly || previewOnlyRef.current)'),
    );
    expect(productsScreen).toContain('getPreviewSellerProducts()');
    expect(productsScreen).toContain('const previewOnly = sellerPreview;');
    expect(financeScreen).toContain('const isDemoPreview = isPreviewMode && isPreviewDemoMode();');
    expect(financeScreen).toContain('const demo = getPreviewFinanceDemo();');
    expect(financeScreen.indexOf('if (isDemoPreview) {')).toBeLessThan(
      financeScreen.indexOf('setSummary(zeroFinanceSummary())'),
    );
  });

  it('allows viewing a demo product and browsing the creation form without enabling writes', () => {
    const root = resolve(__dirname, '..');
    const screen = readFileSync(resolve(root, 'app/(tabs)/products.tsx'), 'utf8');
    const navigation = screen.slice(screen.indexOf('const openProduct ='), screen.indexOf('const openActionSheet ='));
    expect(navigation).toContain('if (previewOnly && !previewDemo)');
    expect(navigation).toContain("router.push(('/product-detail?id=' + product.id)");
    expect(screen).toContain("onPress: () => router.push('/add-product' as never)");
    const detail = readFileSync(resolve(root, 'app/product-detail.tsx'), 'utf8');
    expect(detail.indexOf('getPreviewSellerProducts().find')).toBeLessThan(
      detail.indexOf('if (!id || !userId)'),
    );
  });
});
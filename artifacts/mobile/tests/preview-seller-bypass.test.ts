import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');
const dashboardSource = readFileSync(path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('starts the default web preview as seller and preserves the buyer shortcut', () => {
    expect(layoutSource).toContain(
      "if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain("return v === 'buyer' ? 'buyer' : 'seller';");
    expect(indexSource).toContain(
      "const effectivePreviewRole = Platform.OS === 'web'",
    );
    expect(indexSource).toContain(
      "previewRole === 'buyer' ? '/(buyer)' : '/(tabs)'",
    );
    expect(indexSource).toContain(
      "previewRole === 'buyer' ? 'buyer' : 'seller'",
    );
  });

  it('uses populated seller analytics and balances instead of protected APIs in preview', () => {
    expect(dashboardSource).toContain('const sellerPreview = isSellerDevPreview();');
    expect(dashboardSource).toContain('previewSellerHomeAnalytics(range)');
    expect(dashboardSource).toContain("formatted: '$4,281.22'");
    expect(dashboardSource).toContain("formatted: '$1,842.50'");
  });
});
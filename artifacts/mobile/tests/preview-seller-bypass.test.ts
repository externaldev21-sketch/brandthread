import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');
const dashboardSource = readFileSync(path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('starts the default web preview as seller and preserves explicit preview roles', () => {
    expect(layoutSource).toContain(
      "if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain('if (__DEV__) return getDevWebPreviewRole();');
    expect(layoutSource).toContain("if (v !== 'buyer' && v !== 'seller') return null;");
    expect(indexSource).toContain("const effectivePreviewRole = Platform.OS === 'web'");
    expect(indexSource).toContain('? getDevWebPreviewRole()');
    expect(indexSource).toContain(': DEV_BYPASS_ROLE;');
    expect(indexSource).toContain("effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/'");
    expect(indexSource).toContain(
      "previewRole === 'buyer' ? '/(buyer)' : '/(tabs)'",
    );
  });

  it('uses populated seller analytics and balances instead of protected APIs in preview', () => {
    expect(dashboardSource).toContain('const sellerPreview = isSellerDevPreview();');
    expect(dashboardSource).toContain('previewSellerHomeAnalytics(range)');
    expect(dashboardSource).toContain("formatted: '$4,281.22'");
    expect(dashboardSource).toContain("formatted: '$1,842.50'");
  });

  it('keeps the native dev bypass opt-in via EXPO_PUBLIC_DEV_BYPASS_ROLE, off by default', () => {
    const devBypassSource = readFileSync(path.resolve(__dirname, '../lib/devBypass.ts'), 'utf8');
    expect(devBypassSource).toContain('process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE');
    expect(devBypassSource).not.toMatch(/DEV_BYPASS_ROLE[^=]*=\s*__DEV__\s*\?\s*'seller'/);
  });
});

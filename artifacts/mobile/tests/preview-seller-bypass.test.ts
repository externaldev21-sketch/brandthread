import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
const indexSource = readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');
const dashboardSource = readFileSync(path.resolve(__dirname, '../components/SellerHomeCommerceDashboard.tsx'), 'utf8');

describe('development app preview routing', () => {
  it('starts the temporary default web preview as buyer and preserves explicit preview roles', () => {
    expect(layoutSource).toContain(
      "if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;",
    );
    expect(layoutSource).toContain('if (__DEV__) return getDevWebPreviewRole();');
    expect(layoutSource).toContain("if (v !== 'buyer' && v !== 'seller') return null;");
    // Index's own redirect-away-from-"/" effect must resolve the preview
    // role the same way (isSellerDevPreview/isBuyerDevPreview — the
    // `__DEV__ || NAVIGATION_ISOLATION_TEST` OR, not bare `__DEV__`) so an
    // exported preview build (the screenshot/audit harness) redirects too,
    // not just a local dev server.
    expect(indexSource).toContain("from '@/lib/devPreview'");
    expect(indexSource).toContain('if (isSellerDevPreview()) effectivePreviewRole = ');
    expect(indexSource).toContain('else if (isBuyerDevPreview()) effectivePreviewRole = ');
    expect(indexSource).toContain('effectivePreviewRole = DEV_BYPASS_ROLE;');
    expect(indexSource).toContain("window.location.pathname.replace(/\\/+$/, '') !== ''");
    expect(indexSource).toContain("effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/'");
    expect(indexSource).toContain("previewRole === 'buyer' ? '/(buyer)' : '/(tabs)'");
  });

  it('uses populated seller analytics and balances instead of protected APIs in preview', () => {
    expect(dashboardSource).toContain('const sellerPreview = isSellerDevPreview();');
    expect(dashboardSource).toContain('previewSellerHomeAnalytics(range)');
    expect(dashboardSource).toContain("formatted: '$4,281.22'");
    expect(dashboardSource).toContain("formatted: '$1,842.50'");
  });

  it('temporarily enters buyer on native development without persisting onboarding or affecting production', () => {
    const devBypassSource = readFileSync(path.resolve(__dirname, '../lib/devBypass.ts'), 'utf8');
    expect(devBypassSource).toContain('process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE');
    expect(devBypassSource).toContain("!__DEV__ ? null");
    expect(devBypassSource).toContain("Platform.OS !== 'web' ? 'buyer'");
    expect(layoutSource).toContain('if (PREVIEW_ROLE || DEV_BYPASS_ROLE)');
    expect(layoutSource).toContain('{PREVIEW_ROLE || DEV_BYPASS_ROLE ? (');
    expect(indexSource).toContain("effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/'");
    expect(devBypassSource).not.toContain('AsyncStorage');
  });
});

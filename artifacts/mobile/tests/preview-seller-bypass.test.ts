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
    expect(dashboardSource).toContain("from '@/lib/previewSellerChartData'");
    expect(dashboardSource).toContain("buildPreviewSellerAnalytics(range, isPreviewDemoMode() ? 'demo' : 'fresh')");
    expect(dashboardSource).toContain("formatted: '$4,281.22'");
    expect(dashboardSource).toContain("formatted: '$1,842.50'");
  });

  it('enters seller preview only when explicitly enabled in native development', () => {
    const devBypassSource = readFileSync(path.resolve(__dirname, '../lib/devBypass.ts'), 'utf8');
    const buildFlagsSource = readFileSync(path.resolve(__dirname, '../lib/buildFlags.ts'), 'utf8');
    expect(buildFlagsSource).toMatch(
      /export const DEV_SELLER_PREVIEW = resolveDevSellerPreview\(\s*__DEV__,\s*IS_PROD_NATIVE,\s*process\.env\.EXPO_PUBLIC_DEV_PREVIEW,\s*\);/,
    );
    expect(devBypassSource).toContain("!__DEV__ ? null");
    expect(devBypassSource).toContain("Platform.OS !== 'web' ? (DEV_SELLER_PREVIEW ? 'seller' : null)");
    expect(layoutSource).toContain("DEV_BYPASS_ROLE === 'seller'");
    expect(layoutSource).toContain('{PREVIEW_SESSION_ROLE || DEV_BYPASS_ROLE ? (');
    expect(indexSource).toContain("effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/'");
    expect(devBypassSource).not.toContain('AsyncStorage');
    expect(layoutSource).toMatch(
      /if \(Platform\.OS !== 'web' && DEV_BYPASS_ROLE === 'seller'\) \{\s*setOnboardingChecked\(true\);\s*setOnboardingDone\(true\);[\s\S]*?return;\s*\}/,
    );
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Zero-dead-ends guard for the seller-core area.
 *
 * Scans every seller-core screen/component source file for literal
 * `router.push(...)`, `router.replace(...)`, `router.navigate(...)` and
 * `href={...}` string targets, and asserts each one resolves to a real
 * file under app/. This is a blunt, source-level net that catches routes
 * embedded directly in a screen (e.g. an attachment tap handler) that
 * aren't already covered by a curated catalog test such as
 * components/__tests__/SellerControlCenter.test.ts or
 * tests/settings-routes.test.ts.
 *
 * Dynamic targets (template literals with `${...}` or array routes with
 * `[param]`) are checked against their static prefix only, since the
 * concrete value isn't known statically.
 */

const ROOT = resolve(__dirname, '..');
const APP_DIR = resolve(ROOT, 'app');

const SELLER_CORE_GLOBS = [
  'app/(tabs)/index.tsx',
  'app/(tabs)/orders.tsx',
  'app/(tabs)/products.tsx',
  'app/(tabs)/analytics.tsx',
  'app/(tabs)/marketing.tsx',
  'app/(tabs)/studio.tsx',
  'app/(tabs)/more.tsx',
  'app/inventory.tsx',
  'app/inventory-adjust.tsx',
  'app/inventory-count.tsx',
  'app/inventory-detail.tsx',
  'app/inventory-incoming.tsx',
  'app/inventory-location.tsx',
  'app/inventory-transfer.tsx',
  'app/customers.tsx',
  'app/customer-accounts.tsx',
  'app/customer-events.tsx',
  'app/customer-orders.tsx',
  'app/customer-privacy.tsx',
  'app/analytics-content.tsx',
  'app/analytics-customers.tsx',
  'app/analytics-inventory.tsx',
  'app/analytics-marketing.tsx',
  'app/analytics-production.tsx',
  'app/analytics-products.tsx',
  'app/analytics-profit.tsx',
  'app/analytics-sales.tsx',
  'app/analytics-store.tsx',
  'app/post-analytics.tsx',
  'app/store-builder.tsx',
  'app/store-preview.tsx',
  'app/store-collections.tsx',
  'app/store-domain.tsx',
  'app/store-editor.tsx',
  'app/store-nav.tsx',
  'app/store-pages.tsx',
  'app/store-policies.tsx',
  'app/store-publish.tsx',
  'app/store-sections.tsx',
  'app/store-seo.tsx',
  'app/store-settings.tsx',
  'app/store-theme-picker.tsx',
  'app/store-versions.tsx',
  'app/boost.tsx',
  'app/discounts.tsx',
  'app/team.tsx',
  'app/team-invite.tsx',
  'app/seller-go-live.tsx',
  'app/seller-live.tsx',
  'app/seller-conversation.tsx',
  'app/seller-inbox.tsx',
  'app/seller-settings.tsx',
  'app/order-detail.tsx',
  'app/orders.tsx',
  'app/fulfill-order.tsx',
  'app/fulfill-batch.tsx',
  'app/shipping.tsx',
  'app/shipping-label.tsx',
  'app/shipping-delivery.tsx',
  'app/refund-detail.tsx',
  'app/add-product.tsx',
  'app/product-detail.tsx',
  'app/product-editor.tsx',
  'app/product-bundles.tsx',
  'app/product-bundle-edit.tsx',
  'app/product-import.tsx',
  'app/product-size-chart.tsx',
  'app/design-campaign.tsx',
  'components/SellerStudioRadialMenu.tsx',
  'components/SellerHomeCommerceDashboard.tsx',
  'components/SellerDashboardActionNeeded.tsx',
  'components/SellerDashboardChart.tsx',
  'components/SellerDashboardTopProducts.tsx',
  'components/SellerDashboardRecentOrders.tsx',
  'components/SellerDashboardStatGrid.tsx',
  'components/SellerDashboardSections.tsx',
  'components/SellerDashboardSetupCard.tsx',
].filter((rel) => existsSync(resolve(ROOT, rel)));

// Group-index roots (e.g. '/(tabs)/' or '/(buyer)/') resolve to that
// navigator's default screen and always exist as long as the layout does.
const GROUP_ROOT_RE = /^\([^)]+\)\/?$/;

function candidatesFor(route: string): string[] {
  const trimmed = route.replace(/^\//, '');
  if (trimmed === '' || GROUP_ROOT_RE.test(trimmed)) return [];
  const withoutGroup = trimmed.replace(/^\([^)]+\)\//, '');
  return [
    resolve(APP_DIR, '..', `app/${trimmed}.tsx`),
    resolve(APP_DIR, '..', `app/${trimmed}/index.tsx`),
    resolve(APP_DIR, '..', `app/${withoutGroup}.tsx`),
    resolve(APP_DIR, '..', `app/${withoutGroup}/index.tsx`),
  ];
}

// Matches router.push('/x'), router.replace(`/x`), router.navigate("/x"), href={'/x'}
const NAV_TARGET_RE = /(?:router\.(?:push|replace|navigate)|href)\s*[:(]\s*[`'"]([^`'"]+)[`'"]/g;

interface Finding {
  file: string;
  route: string;
}

function scanFile(relPath: string): Finding[] {
  const text = readFileSync(resolve(ROOT, relPath), 'utf8');
  const findings: Finding[] = [];
  let match: RegExpExecArray | null;
  NAV_TARGET_RE.lastIndex = 0;
  while ((match = NAV_TARGET_RE.exec(text))) {
    const raw = match[1];
    if (!raw.startsWith('/')) continue; // ignore mailto:, external urls, etc.
    // Strip query/hash and cut at the first dynamic segment, keeping only
    // the static, checkable prefix.
    let route = raw.split('?')[0].split('#')[0];
    const dynamicIdx = Math.min(
      ...['${', '['].map((tok) => {
        const i = route.indexOf(tok);
        return i === -1 ? Infinity : i;
      }),
    );
    if (Number.isFinite(dynamicIdx)) route = route.slice(0, dynamicIdx);
    route = route.replace(/\/+$/, '') || '/';
    findings.push({ file: relPath, route });
  }
  return findings;
}

describe('Seller-core screens — every navigation target resolves to a real route', () => {
  it('has a non-empty file list to scan (sanity check)', () => {
    expect(SELLER_CORE_GLOBS.length).toBeGreaterThan(20);
  });

  it('every router.push/replace/navigate and href target exists under app/', () => {
    const missing: string[] = [];
    for (const rel of SELLER_CORE_GLOBS) {
      for (const { file, route } of scanFile(rel)) {
        const candidates = candidatesFor(route);
        if (candidates.length === 0) continue; // group root, always valid
        const found = candidates.some((c) => existsSync(c));
        if (!found) missing.push(`${file}: ${route}`);
      }
    }
    expect(missing, `dead navigation targets found:\n${missing.join('\n')}`).toEqual([]);
  });
});

/**
 * Seller bottom navigation layout contract tests.
 *
 * Asserts:
 *  1. Exactly one global tab bar — in SellerGlobalTabBar.tsx, mounted via
 *     SellerBarGate in app/_layout.tsx. No second bar in (tabs)/_layout.tsx.
 *  2. Design Studio back arrow present (design.tsx).
 *  3. Four primary tab destinations preserved.
 *  4. Studio radial menu and AI button wiring.
 *  5. Deny-list of full-screen seller routes: the bar shows by default on
 *     every seller route — including normal pushed screens like settings,
 *     billing, team, customers, payments, order-detail, seller-profile,
 *     manufacturer-hub — and is hidden ONLY on the curated set of genuine
 *     full-screen creation/camera/checkout flows (create-post, add-product,
 *     plans, etc.), since the bar (position: absolute) would overlay them.
 *  6. Seller root route inclusion: key routes map to a primary tab.
 *  7. Route-to-active-tab classification present in SellerGlobalTabBar.
 *  8. SellerShellContext is used as the authoritative source — no parallel
 *     AsyncStorage read in SellerBarGate.
 *  9. PREVIEW_ROLE seller bypass is honored in SellerBarGate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const tabBarSource    = read('components/SellerGlobalTabBar.tsx');
const tabsLayout      = read('app/(tabs)/_layout.tsx');
const rootLayout      = read('app/_layout.tsx');
const designScreen    = read('app/design.tsx');
const shellContext    = read('contexts/SellerShellContext.tsx');

// ─── 1. Single global bar — not duplicated ────────────────────────────────────

describe('single global seller tab bar', () => {
  it('SellerGlobalTabBar component exists and exports the bar', () => {
    expect(tabBarSource).toContain('export function SellerGlobalTabBar');
  });

  it('(tabs)/_layout.tsx disables the local tab bar with tabBar={() => null}', () => {
    expect(tabsLayout).toContain('tabBar={() => null}');
    // Must NOT import or render its own SellerGlobalTabBar or CustomTabBar
    expect(tabsLayout).not.toContain('import SellerGlobalTabBar');
    expect(tabsLayout).not.toContain('CustomTabBar');
    // Must NOT import or render SellerStudioRadialMenu (now in global shell)
    expect(tabsLayout).not.toContain('import SellerStudioRadialMenu');
    expect(tabsLayout).not.toContain('<SellerStudioRadialMenu');
  });

  it('root _layout.tsx mounts SellerBarGate exactly once', () => {
    const occurrences = (rootLayout.match(/<SellerBarGate/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('root _layout.tsx imports SellerGlobalTabBar from the component file', () => {
    expect(rootLayout).toContain("from '@/components/SellerGlobalTabBar'");
  });
});

// ─── 2. Design Studio back arrow ─────────────────────────────────────────────

describe('Design Studio back arrow', () => {
  it('has a back button with correct testID', () => {
    expect(designScreen).toContain('testID="design-gallery-back"');
  });

  it('uses router.back() for history and a seller fallback when no history', () => {
    expect(designScreen).toContain('router.back()');
    // The replace call uses a type cast (as never) for Expo Router's strict routing
    expect(designScreen).toContain("'/(tabs)/'");
    expect(designScreen).toContain('router.replace');
  });

  it('uses Expo Router to check whether back navigation is available', () => {
    expect(designScreen).toContain('router.canGoBack()');
    expect(designScreen).not.toContain('useNavigationState');
    expect(designScreen).toContain('canGoBack');
  });

  it('has accessible back button label', () => {
    expect(designScreen).toContain('accessibilityLabel="Back"');
  });
});

// ─── 3. Four primary tab destinations preserved ───────────────────────────────

describe('seller bottom navigation layout', () => {
  it('keeps the requested four center destinations', () => {
    expect(tabBarSource).toContain("label: 'Dashboard'");
    expect(tabBarSource).toContain("label: 'Products'");
    expect(tabBarSource).toContain("label: 'Orders'");
    expect(tabBarSource).toContain("label: 'Profile'");
  });

  it('(tabs) layout title options also reference all four destinations', () => {
    expect(tabsLayout).toContain("title: 'Dashboard'");
    expect(tabsLayout).toContain("title: 'Products'");
    expect(tabsLayout).toContain("title: 'Orders'");
    expect(tabsLayout).toContain("title: 'Profile'");
  });

  it('places Studio and Brandthread AI in fixed side circles', () => {
    expect(tabBarSource).toContain('testID="seller-bottom-menu"');
    expect(tabBarSource).toContain('accessibilityLabel="Open Studio tools"');
    expect(tabBarSource).toContain('testID="seller-bottom-ai"');
    expect(tabBarSource).toContain('accessibilityLabel="Open Brandthread AI"');
  });

  it('SellerStudioRadialMenu is wired inside SellerBarGate in root layout', () => {
    expect(rootLayout).toContain('SellerStudioRadialMenu');
    expect(rootLayout).toContain('hideTrigger');
    expect(rootLayout).toContain('openRequestKey');
  });
});

// ─── 4. detachInactiveScreens and freezeOnBlur preserved ─────────────────────

describe('tab freeze/detach behavior', () => {
  it('(tabs) layout retains detachInactiveScreens', () => {
    expect(tabsLayout).toContain('detachInactiveScreens');
  });

  it('(tabs) layout retains freezeOnBlur: true', () => {
    expect(tabsLayout).toContain('freezeOnBlur: true');
  });

  it('(tabs) layout retains opaque scene background', () => {
    expect(tabsLayout).toContain('sceneStyle: { backgroundColor: theme.background }');
  });
});

// ─── 5. Deny-list of full-screen seller routes ────────────────────────────────

describe('seller bar full-screen deny-list', () => {
  const setBlock = () =>
    rootLayout.match(
      /const SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set\(\[([\s\S]*?)\]\)/,
    );

  it('the SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS deny-list exists', () => {
    expect(rootLayout).toContain('SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS');
    expect(setBlock(), 'SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS set must exist').toBeTruthy();
  });

  // The `(tabs)` shell group must never appear in a deny-list, since that
  // would hide the bar on every primary tab screen.
  it('does not deny-list the (tabs) shell group', () => {
    const setBody = setBlock()![1];
    expect(setBody).not.toContain("'(tabs)'");
  });

  // Genuine full-screen creation/camera/checkout flows: the bar
  // (position: absolute) would overlay their own bottom-anchored controls.
  const mustHideBar = [
    'create-post',
    'camera-capture',
    'add-product',
    'plans',
    'design-canvas',
    'store-generate',
    'store-generating',
    'quote-request',
    'seller-go-live',
    'seller-live',
  ];

  for (const route of mustHideBar) {
    it(`hides the seller bar on genuine full-screen route "${route}"`, () => {
      const setBody = setBlock()![1];
      expect(setBody).toContain(`'${route}'`);
    });
  }

  // Normal pushed seller management screens — the bar must show on all of
  // these, so none of them may appear in the deny-list.
  const mustShowBar = [
    'settings',
    'general-settings',
    'security',
    'notifications-settings',
    'billing',
    'team',
    'team-invite',
    'taxes-duties',
    'integrations',
    'edit-profile',
    'customers',
    'customer-accounts',
    'customer-events',
    'customer-privacy',
    'payments',
    'payouts',
    'finance',
    'order-detail',
    'return-detail',
    'refund-detail',
    'dispute-detail',
    'shipping',
    'product-detail',
    'product-import',
    'product-store',
    'store-collections',
    'store-nav',
    'store-pages',
    'store-policies',
    'store-publish',
    'store-seo',
    'store-preview',
    'store-editor',
    'seller-profile',
    'seller-verification',
    'seller-data-export',
    'discounts',
    'inventory',
    'locations',
    'admin-reports',
    'manufacturer-hub',
    'manufacturer-messages',
    'manufacturer-onboard',
    'invite-manufacturer',
    'quote-detail',
    'sample-detail',
    'production-detail',
    'automation',
    'community-chat',
    'request-sample',
    'design-garment',
    'design-templates',
    'design-brand-assets',
    'design-ai-photoshoot',
    'design-bg-replace',
    'design-campaign',
    'design-mockup-to-model',
    'design-text-to-design',
    'design-mockup-preview',
    'lifestyle-images',
    'tech-pack-generator',
    '(tabs)',
  ];

  for (const route of mustShowBar) {
    it(`does NOT hide the seller bar on normal seller route "${route}"`, () => {
      const setBody = setBlock()![1];
      expect(setBody).not.toContain(`'${route}'`);
    });
  }

  it('uses a deny-list check (isFullScreenRoute), not an allow-list, to gate the bar', () => {
    expect(rootLayout).toContain('isFullScreenRoute');
    expect(rootLayout).not.toContain('SELLER_TAB_BAR_SHELL_SEGMENTS');
    expect(rootLayout).not.toContain('isShellRoute');
  });
});

// ─── 6. Seller root route inclusion in route-to-tab map ──────────────────────

describe('seller root route inclusion in route-to-tab map', () => {
  it('SellerGlobalTabBar has a ROUTE_TO_TAB mapping covering seller screens', () => {
    expect(tabBarSource).toContain('ROUTE_TO_TAB');
  });

  it('products routes map correctly', () => {
    expect(tabBarSource).toContain("'product-editor': 'products'");
    expect(tabBarSource).toContain("'inventory': 'products'");
    expect(tabBarSource).toContain("'drafts': 'products'");
  });

  it('orders routes map correctly', () => {
    expect(tabBarSource).toContain("'order-detail': 'orders'");
    expect(tabBarSource).toContain("'shipping-label': 'orders'");
  });

  it('settings routes map correctly to profile tab', () => {
    expect(tabBarSource).toContain("'settings': 'profile'");
    expect(tabBarSource).toContain("'billing': 'profile'");
    expect(tabBarSource).toContain("'payouts': 'profile'");
  });
});

// ─── 7. Active state uses segments, not navigator index ───────────────────────

describe('pathname-based active tab state', () => {
  it('SellerGlobalTabBar uses useSegments for active state', () => {
    expect(tabBarSource).toContain('useSegments');
    expect(tabBarSource).toContain('getActiveTab');
  });

  it('getActiveTab function is defined and handles (tabs) group', () => {
    expect(tabBarSource).toContain("function getActiveTab");
    expect(tabBarSource).toContain("'(tabs)'");
  });

  it('active tab does not depend on nested tab navigator state.index', () => {
    expect(tabBarSource).not.toContain('state.index');
    expect(tabBarSource).not.toContain('state.routes');
  });
});

// ─── 8. SellerShellContext as authoritative source — no parallel read ─────────

describe('SellerShellContext — authoritative seller state', () => {
  it('SellerShellContext exists and exports useSellerShell', () => {
    expect(shellContext).toContain('export function useSellerShell');
    expect(shellContext).toContain('SellerShellProvider');
    expect(shellContext).toContain('isActiveSeller');
    expect(shellContext).toContain('setActiveSeller');
  });

  it('SellerShellProvider is mounted in the root provider tree', () => {
    expect(rootLayout).toContain('SellerShellProvider');
    expect(rootLayout).toContain("from '@/contexts/SellerShellContext'");
  });

  it('AuthGate calls setActiveSeller after resolving onboarding+role', () => {
    expect(rootLayout).toContain('setActiveSeller');
    // Must be called with the resolved seller boolean
    expect(rootLayout).toContain("setActiveSeller(done && role === 'seller')");
  });

  it('SellerBarGate consumes useSellerShell instead of reading AsyncStorage directly', () => {
    // SellerBarGate must use the context, not its own AsyncStorage.multiGet
    const barGateBlock = rootLayout.match(
      /function SellerBarGate\(\)([\s\S]*?)^}/m,
    );
    expect(barGateBlock).toBeTruthy();
    const gateBody = barGateBlock![1];
    expect(gateBody).toContain('useSellerShell');
    expect(gateBody).not.toContain('AsyncStorage');
  });

  it('AuthGate clears seller state on sign-out', () => {
    expect(rootLayout).toContain('setActiveSeller(false)');
  });
});

// ─── 9. PREVIEW_ROLE seller bypass in SellerBarGate ──────────────────────────

describe('PREVIEW_ROLE seller bypass', () => {
  it('SellerBarGate honors PREVIEW_ROLE seller bypass for dev web QA', () => {
    expect(rootLayout).toContain('PREVIEW_ROLE');
    // Must check for seller specifically
    expect(rootLayout).toContain("PREVIEW_ROLE === 'seller'");
    expect(rootLayout).toContain('isPreviewSeller');
  });

  it('showBar is true when either isActiveSeller or isPreviewSeller', () => {
    const barGateBlock = rootLayout.match(
      /function SellerBarGate\(\)([\s\S]*?)^}/m,
    );
    expect(barGateBlock).toBeTruthy();
    const gateBody = barGateBlock![1];
    expect(gateBody).toContain('isActiveSeller || isPreviewSeller');
  });
});

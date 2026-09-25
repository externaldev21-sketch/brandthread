import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_ITEMS } from '../lib/sellerControlCenter';
import { requiresSellerPreviewSignIn } from '../lib/sellerPreviewRoutes';

describe('signed-out seller preview routing', () => {
  it('keeps the dashboard and authentication accessible', () => {
    expect(requiresSellerPreviewSignIn('index', true)).toBe(false);
    expect(requiresSellerPreviewSignIn('(tabs)', false)).toBe(false);
    expect(requiresSellerPreviewSignIn('sign-in', false)).toBe(false);
    expect(requiresSellerPreviewSignIn('forgot-password', false)).toBe(false);
  });

  it('prompts for every secondary tab and every control-center shortcut', () => {
    for (const tab of ['products', 'orders', 'profile', 'analytics', 'marketing', 'studio', 'more', 'feed', 'following']) {
      expect(requiresSellerPreviewSignIn(tab, true), tab).toBe(true);
    }
    for (const item of ALL_ITEMS) {
      const path = item.route.replace(/^\//, '').split('?')[0];
      const tab = path.startsWith('(tabs)/');
      expect(requiresSellerPreviewSignIn(tab ? path.slice(7) : path, tab), item.route).toBe(true);
    }
    expect(requiresSellerPreviewSignIn('ai-brain', false)).toBe(true);
    expect(requiresSellerPreviewSignIn('some-new-seller-screen', false)).toBe(true);
  });

  it('gates before mounting protected screens in both navigator layouts', () => {
    const root = readFileSync(join(__dirname, '../app/_layout.tsx'), 'utf8');
    const tabs = readFileSync(join(__dirname, '../app/(tabs)/_layout.tsx'), 'utf8');
    const gate = readFileSync(join(__dirname, '../components/SellerPreviewRouteGate.tsx'), 'utf8');
    expect(root).toContain('<IsolatedStackScene routeName={route.name}>{children}</IsolatedStackScene>');
    expect(root).toContain('<SellerPreviewRouteGate route={routeName}>{children}</SellerPreviewRouteGate>');
    expect(tabs).toContain('<SellerPreviewRouteGate route={route.name} isTab>{children}</SellerPreviewRouteGate>');
    expect(gate).toContain('isLoaded && isSignedIn && userId');
    expect(gate).toContain('return <>{children}</>');
    expect(gate).toContain('router.push(\'/sign-in\')');
  });
});
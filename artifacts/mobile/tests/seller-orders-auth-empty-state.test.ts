import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ordersSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/orders.tsx'),
  'utf8',
);
const apiSource = fs.readFileSync(
  path.resolve(__dirname, '../lib/api.ts'),
  'utf8',
);

describe('seller orders read state', () => {
  it('waits for a signed-in seller before requesting orders', () => {
    expect(ordersSource).toContain('isLoaded: authLoaded');
    expect(ordersSource).toContain('if (!authLoaded || !isSignedIn || !userId)');
    expect(ordersSource).toContain('[authLoaded, isSignedIn, loadData, userId]');
    // Safety-net effect for item 127's infinite-skeleton bug: useFocusEffect
    // only re-runs on an actual focus event, not when auth becomes ready
    // while the tab is already focused. See the comment above it in
    // orders.tsx.
    expect(ordersSource).toContain('if (hasLoadedRef.current || timerRef.current !== null) return;');
  });

  it('uses an honest, flat empty state — icon + line only, no button, no card/box behind it', () => {
    expect(ordersSource).toContain('<EmptyState');
    expect(ordersSource).toContain('icon="shopping-bag"');
    expect(ordersSource).toContain('message="Your orders will show up here once a buyer checks out."');
    // Dev's repeated, explicit instruction: no CTA on this empty state, and
    // no grey card/box container behind it — flat, directly on the screen
    // background. (Superseded item 40 CTA; see PR for seller-orders-cleanup.)
    expect(ordersSource).not.toContain('actionLabel="Add your first product"');
    expect(ordersSource).not.toContain('onAction={() => router.push(\'/add-product\'');
    expect(ordersSource).not.toContain('if (loading) return null');
    expect(ordersSource).not.toContain('<BrandedLoader');
    expect(ordersSource).not.toContain('name="scissors"');
    expect(ordersSource).not.toContain('Orders unavailable right now');
    expect(ordersSource).not.toContain('Could not load orders');
    expect(ordersSource).not.toContain('Check your connection and try again');
    expect(ordersSource).not.toContain('Failed to load seller orders');
    expect(apiSource).toContain("list:           ()                       => quietGet('/api/orders')");
  });
});
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
  });

  it('uses an honest empty state, without connection/API error banners, that gives the seller a real next step', () => {
    expect(ordersSource).toContain('<EmptyState');
    expect(ordersSource).toContain('icon="shopping-bag"');
    expect(ordersSource).toContain('message="Your orders will show up here once a buyer checks out."');
    // A real CTA instead of a dead end — see item 40.
    expect(ordersSource).toContain('actionLabel="Add your first product"');
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
/**
 * Every seller list screen (Orders, Products, Customers, Payouts, Discounts,
 * Collections, Messages) renders empty/error states through the one shared
 * `EmptyState` component (components/layout/EmptyState.tsx) — icon, bold
 * title, one-line subtitle, optional button — not the separate, larger
 * illustration-circle EmptyState from components/BrandthreadUI.tsx.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SCREENS: Record<string, string> = {
  Orders: 'app/(tabs)/orders.tsx',
  Products: 'app/(tabs)/products.tsx',
  Customers: 'app/customers.tsx',
  Payouts: 'app/payouts.tsx',
  Discounts: 'app/discounts.tsx',
  Collections: 'app/store-collections.tsx',
  Messages: 'app/seller-inbox.tsx',
};

describe('Every seller list screen uses the shared layout EmptyState', () => {
  for (const [name, path] of Object.entries(SCREENS)) {
    it(`${name} imports EmptyState from @/components/layout`, () => {
      const source = read(path);
      expect(source).toMatch(/import\s*\{[^}]*\bEmptyState\b[^}]*\}\s*from\s*['"]@\/components\/layout['"]/);
      expect(source).toContain('<EmptyState');
    });
  }
});

describe('Orders empty state has a title, matching Products/Collections/Messages', () => {
  it('shows "No orders yet" (per-filter titles, no filler subtitle), no fake numbers', () => {
    // Dev (products/orders polish): the empty state names exactly what the
    // selected filter found, as a single title — copy lives in
    // lib/sellerLists/emptyCopy.ts, the screen renders orderEmptyCopy().
    const source = read(SCREENS.Orders);
    expect(source).toContain('orderEmptyCopy(activeFilter, searchQuery)');
    expect(source).toContain('title={emptyCopy.title}');
    expect(source).not.toContain('message="Orders show up here once a buyer checks out."');
    expect(read('lib/sellerLists/emptyCopy.ts')).toContain("all: { icon: 'shopping-bag', title: 'No orders yet' }");
  });
});

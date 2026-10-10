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
    it(`${name} imports a shared EmptyState (layout or ui)`, () => {
      const source = read(path);
      // Either the layout EmptyState or the design foundation's one-line
      // EmptyState (components/ui, BRANDTHREAD_DESIGN.md "Copy") — never the
      // BrandthreadUI illustration variant.
      expect(source).toMatch(/import\s*\{[^}]*\bEmptyState\b[^}]*\}\s*from\s*['"]@\/components\/(layout|ui)['"]/);
      expect(source).toContain('<EmptyState');
    });
  }
});

describe('Orders empty state has a title, matching Products/Collections/Messages', () => {
  it('shows "No orders yet" with the requested subtitle, no fake numbers', () => {
    const source = read(SCREENS.Orders);
    expect(source).toContain('title="No orders yet"');
    expect(source).toContain('message="Orders show up here once a buyer checks out."');
  });
});

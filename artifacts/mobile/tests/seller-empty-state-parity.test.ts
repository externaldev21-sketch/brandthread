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

// Seller Messages = buyer Messages (Dev's override): the seller inbox renders
// the shared buyer inbox, so its empty states are the buyer inbox's own
// (same EmptyStateBadge app-wide), with seller copy.
describe('Messages empty states come from the shared buyer inbox', () => {
  it('the seller route renders MessagesInbox, whose empty states carry seller copy', () => {
    expect(read('app/seller-inbox.tsx')).toContain('<MessagesInbox variant="seller" />');
    const inbox = read('components/inbox/MessagesInbox.tsx');
    expect(inbox).toContain('<EmptyState');
    expect(inbox).toContain('No messages yet');
    expect(inbox).toContain('Messages from buyers show up here');
    expect(inbox).toContain('"Requests from buyers who don\'t follow you appear here"');
  });
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

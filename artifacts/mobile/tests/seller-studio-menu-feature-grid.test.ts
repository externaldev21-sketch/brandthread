import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Studio sheet redesign (Dev-approved): reskin of Binance's own Features
 * bottom sheet (https://mobbin.com/screens/b2cccef3-bc9c-4320-b7c0-e495dd4c3627)
 * in this app's black/white/silver palette. Keeps the handle and swipe/tap-
 * to-dismiss (covered by seller-studio-menu-swipe-dismiss.test.ts) and the
 * top store-header row (avatar, store name, setup %, white "View store"
 * pill). Removes the search bar, the editable pinned-shortcuts row, and the
 * SELL/GROW grouped-section list, replacing all three with one flat 4-column
 * grid of every previously-reachable destination.
 */
describe('Seller Studio sheet: search bar, pinned shortcuts and grouped sections are gone', () => {
  it('no SearchBar, no pin editing, no per-section grouped list remain', () => {
    expect(studio).not.toContain('SearchBar');
    expect(studio).not.toContain('Pinned shortcuts');
    expect(studio).not.toContain('Edit pinned shortcuts');
    expect(studio).not.toContain('Add a pinned shortcut');
    expect(studio).not.toContain('pin-picker-sheet');
    expect(studio).not.toContain('SECTIONS.map');
  });

  it('still keeps the store header row (avatar, store name, setup %, View store pill)', () => {
    expect(studio).toContain('accessibilityLabel="View store"');
    expect(studio).toContain("storeIsLive ? 'Store live' : `${setupPercent}% set up`");
  });

  it('still keeps the handle and the swipe/tap-to-dismiss sheet, no close (X) button', () => {
    expect(studio).toContain('<SheetHandle />');
    expect(studio).toContain('<GestureDetector gesture={panGesture}>');
    expect(studio).not.toContain('testID="seller-studio-menu-close"');
  });
});

describe('Seller Studio sheet: 4-column feature grid', () => {
  it('renders GRID_ITEMS as a 4-column, 25%-width-cell grid', () => {
    expect(studio).toContain('const GRID_COLUMNS = 4;');
    expect(studio).toContain("gridCell: { width: '25%'");
    expect(studio).toContain('{GRID_ITEMS.map((item) => renderGridItem(item))}');
  });

  it('orders the named priority destinations first: Add product, Orders, Go Live, Post video, Products, Discounts, Analytics, Payouts, Content, Messages, Boost, Settings', () => {
    expect(studio).toContain(
      "const PRIORITY_IDS = [\n" +
      "  'add-product', 'orders', 'go-live', 'post-video',\n" +
      "  'products', 'discounts', 'analytics', 'payouts',\n" +
      "  'content', 'messages', 'boost', 'settings',\n" +
      "];",
    );
  });

  it('appends every other previously-reachable route after the priority row so nothing is dropped', () => {
    expect(studio).toContain('...ALL_ITEMS.filter((item) => !PRIORITY_IDS.includes(item.id)),');
  });
});

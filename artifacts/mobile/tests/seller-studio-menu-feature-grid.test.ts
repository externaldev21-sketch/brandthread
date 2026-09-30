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

  it('appends every other previously-reachable route after the priority row so nothing is dropped — except help, deliberately excluded (see next describe block)', () => {
    expect(studio).toContain('...ALL_ITEMS.filter((item) => !PRIORITY_IDS.includes(item.id) && !GRID_EXCLUDED_IDS.includes(item.id)),');
  });
});

/**
 * Dev's bug report on this same sheet (round 2): a mid-word line break
 * ("Manufacture/r Hub"), inconsistent row heights from some 2-line labels
 * sitting next to 1-line ones, Boost and Create Ad sharing one icon, and
 * Help & Support left alone in an otherwise-empty final row.
 */
describe('Seller Studio sheet: label wrapping, row alignment, icon uniqueness, no orphan row', () => {
  it('resets wordWrap to normal on the grid label, so a long word overflows/wraps at spaces only — never mid-word (react-native-web defaults numberOfLines>1 Text to wordWrap: break-word)', () => {
    expect(studio).toContain("wordWrap: 'normal'");
  });

  it('reserves a fixed 2-line-tall box for every label, so a 1-line label and a 2-line label in the same row still align', () => {
    expect(studio).toContain('const GRID_LABEL_LINE_HEIGHT = 15;');
    expect(studio).toContain('height: GRID_LABEL_LINE_HEIGHT * 2,');
  });

  it("renders each grid item's shortLabel when set, falling back to its full label", () => {
    expect(studio).toContain('{item.shortLabel ?? item.label}');
    // Accessibility must still announce the full, unabbreviated name.
    expect(studio).toContain('accessibilityLabel={item.label}');
  });

  it('excludes help from the grid — it moved to a header "?" icon instead, and 28 remaining items divide evenly into full rows of 4', () => {
    expect(studio).toContain("const GRID_EXCLUDED_IDS = ['help'];");
    expect(studio).toContain("accessibilityLabel=\"Help & Support\"");
    expect(studio).toContain("router.push('/help' as never)");
  });
});

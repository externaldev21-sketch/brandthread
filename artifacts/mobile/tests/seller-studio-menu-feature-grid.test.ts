import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Studio sheet, second redesign (Dev's words: "every icon is its own
 * screen, swipe across and feel boom boom boom, release on the one you
 * want and it opens"). Replaces the 4-column grid (still covered
 * historically by this file's name) with a full-screen card carousel: one
 * destination shown at a time, scrubbed through by a horizontal drag.
 * Keeps the handle, the dismiss-swipe, the store header (with its avatar
 * fix — see seller-studio-avatar-fix.test.ts), and the "no close (X)
 * button" call — dismissal is still swipe/tap-backdrop only.
 */
describe('Seller Studio sheet: search bar, pinned shortcuts and grouped sections stay gone', () => {
  it('no SearchBar, no pin editing, no per-section grouped list, no old 4-column grid', () => {
    expect(studio).not.toContain('SearchBar');
    expect(studio).not.toContain('Pinned shortcuts');
    expect(studio).not.toContain('Edit pinned shortcuts');
    expect(studio).not.toContain('Add a pinned shortcut');
    expect(studio).not.toContain('pin-picker-sheet');
    expect(studio).not.toContain('SECTIONS.map');
    expect(studio).not.toContain('GRID_COLUMNS');
    expect(studio).not.toContain("gridCell: { width: '25%'");
  });

  it('still keeps the store header row (avatar, store name, setup %, View store pill)', () => {
    expect(studio).toContain('accessibilityLabel="View store"');
    expect(studio).toContain("storeIsLive ? 'Store live' : `${setupPercent}% set up`");
  });

  it('still keeps the handle and dismiss-swipe, no close (X) button', () => {
    expect(studio).toContain('<SheetHandle />');
    expect(studio).not.toContain('testID="seller-studio-menu-close"');
  });
});

/**
 * Dev's menu consolidation pass: only destinations with NO other entry
 * point anywhere else in the app stay in the carousel. See the component's
 * own MENU_EXCLUDED_IDS comment for exactly where each excluded item's real
 * entry point lives — this test locks the two lists themselves, not the
 * prose explaining them.
 */
describe('Seller Studio sheet: menu consolidation — only destinations with no other entry point', () => {
  it('excludes every item that has a real entry point elsewhere', () => {
    const excluded = [
      'orders', 'discounts', 'products', 'post-video', 'messages', 'boost',
      'store-preview', 'subscription', 'store-builder', 'shipping', 'team',
      'settings', 'help',
    ];
    excluded.forEach((id) => {
      expect(studio, `${id} should be in MENU_EXCLUDED_IDS`).toContain(`'${id}'`);
    });
    expect(studio).toContain('const MENU_EXCLUDED_IDS = [');
  });

  it('keeps the Dev-named-no-matter-what items plus everything with no other entry point', () => {
    const kept = [
      'add-product', 'go-live', 'analytics', 'payouts', 'community', 'taxes',
      'content', 'finance', 'manufacturer', 'customers',
      'design-studio', 'mockup-to-model', 'remove-bg', 'ai-design', 'campaign-gen', 'ai-photoshoot',
    ];
    kept.forEach((id) => {
      expect(studio, `${id} should be in CARD_ORDER`).toContain(`'${id}'`);
    });
    expect(studio).toContain('const CARD_ORDER = [');
  });

  it('warns in dev if an item is ever left out of both lists (never silently unreachable)', () => {
    expect(studio).toContain('missing.length > 0');
    expect(studio).toContain('unreachable from anywhere until sorted into one of the two');
  });
});

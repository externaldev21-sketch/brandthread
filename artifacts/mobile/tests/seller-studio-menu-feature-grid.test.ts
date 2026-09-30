import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Studio page — Dev's final layout call: a full-screen page (not a sheet),
 * one destination shown at a time as a full-bleed cover, scrubbed through
 * by a horizontal drag. Keeps the store header (with its avatar/profile-
 * photo fix — see seller-studio-avatar-fix.test.ts) and now has a real
 * close (X) button alongside swipe-down-to-dismiss (see
 * seller-studio-menu-swipe-dismiss.test.ts).
 */
describe('Seller Studio page: search bar, pinned shortcuts and grouped sections stay gone', () => {
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

  it('still keeps the store header row (avatar/photo, store name, setup progress, View store, close)', () => {
    expect(studio).toContain('accessibilityLabel="View store"');
    expect(studio).toContain('accessibilityLabel="Close Studio tools"');
    expect(studio).toContain('setupBarTrack');
  });

  it('no "?" help icon — Settings > Help & support covers it instead', () => {
    expect(studio).not.toContain('accessibilityLabel="Help & Support"');
    expect(studio).not.toContain('help-circle');
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
      'orders', 'discounts', 'products', 'messages', 'boost',
      'store-preview', 'subscription', 'store-builder', 'shipping', 'team',
      'settings', 'help',
      // Dev, later round: "I want taxes and duties removed... Content can
      // be removed. Finance can be removed" — from this menu only.
      'taxes', 'content', 'finance',
    ];
    excluded.forEach((id) => {
      expect(studio, `${id} should be in MENU_EXCLUDED_IDS`).toContain(`'${id}'`);
    });
    expect(studio).toContain('const MENU_EXCLUDED_IDS = [');
  });

  it('keeps the Dev-named-no-matter-what items plus everything with no other entry point, with Create post (post-video) leading', () => {
    const kept = [
      'post-video', 'add-product', 'go-live', 'analytics', 'payouts', 'customers', 'community',
      'manufacturer', 'design-studio', 'mockup-to-model', 'remove-bg', 'ai-design', 'campaign-gen', 'ai-photoshoot',
    ];
    kept.forEach((id) => {
      expect(studio, `${id} should be in CARD_ORDER`).toContain(`'${id}'`);
    });
    expect(studio).toContain('const CARD_ORDER = [');
    // "Make the create post one the first one" — the menu opens on
    // CARD_ORDER[0], so post-video must lead the list, not just appear in it.
    const orderBlock = studio.slice(studio.indexOf('const CARD_ORDER = ['), studio.indexOf('];', studio.indexOf('const CARD_ORDER = [')));
    expect(orderBlock.indexOf("'post-video'")).toBeLessThan(orderBlock.indexOf("'add-product'"));
  });

  it('warns in dev if an item is ever left out of both lists (never silently unreachable)', () => {
    expect(studio).toContain('missing.length > 0');
    expect(studio).toContain('unreachable from anywhere until sorted into one of the two');
  });
});

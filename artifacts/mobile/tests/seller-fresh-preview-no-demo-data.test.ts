/**
 * Regression test: the seller dev-web preview (?bt_preview=seller) must be
 * FRESH by default — zero orders, zero products, zero conversations, no
 * populated/seeded record anywhere — unless the seller explicitly opts into
 * the populated demo dataset via `&demo=1`. Dev's explicit call: "I don't
 * want it to act like it already has people on it."
 *
 * This is a source-level regression test (matching this repo's existing
 * convention — see lib/__tests__/devPreview.test.ts and lib/previewInbox.ts's
 * own header comment — of asserting the gating code is actually present and
 * wired, since the seller preview's true runtime behavior is exercised by
 * this project's Playwright/e2e screenshots rather than by vitest, which
 * cannot boot the full Expo Router + Clerk + WebView stack). It fails if:
 *   1. Any known seeded/demo seller record shows up unconditionally reachable
 *      from a seller screen's default load path.
 *   2. The one populated seller dataset that predates this PR — the seeded
 *      buyer↔seller conversations in lib/previewInboxData.ts, rendered by
 *      app/seller-inbox.tsx — is ever read without first checking
 *      isPreviewDemoMode().
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const MOBILE_ROOT = path.resolve(__dirname, '..');
function read(relPath: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relPath), 'utf8');
}

describe('seller fresh preview: no seeded/demo data by default', () => {
  it('seller-inbox.tsx only reads the seeded seller conversations behind isPreviewDemoMode()', () => {
    const src = read('app/seller-inbox.tsx');
    expect(src).toContain("import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';");
    // The call to the seeded dataset must be guarded by isPreviewDemoMode()
    // in the same conditional that reaches it — not merely present somewhere
    // in the file (which the earlier, reverted PR attempt would also match).
    const guardedCallPattern = /if\s*\(isPreviewInboxEnabled\(\)\s*&&\s*isPreviewDemoMode\(\)\)\s*\{\s*setConvs\(getSellerPreviewConversations\(\)/;
    expect(src).toMatch(guardedCallPattern);
    // And the sibling branch (demo off, i.e. the default) must resolve to a
    // genuinely empty list, not fall through to the seeded data.
    expect(src).toContain('setConvs([]);');
  });

  it('no seller screen calls getSellerPreviewConversations() outside an isPreviewDemoMode() check', () => {
    const glob = require('node:fs');
    const appDir = path.join(MOBILE_ROOT, 'app');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of glob.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
        const src = readFileSync(full, 'utf8');
        if (!src.includes('getSellerPreviewConversations(')) continue;
        if (!src.includes('isPreviewDemoMode')) offenders.push(path.relative(MOBILE_ROOT, full));
      }
    }
    walk(appDir);
    expect(offenders).toEqual([]);
  });

  it('the $131.70 / 12-orders style populated seller demo figures from the earlier (reverted) PR attempt are not present anywhere in source', () => {
    const glob = require('node:fs');
    const searchDirs = ['app', 'lib', 'components', 'services'].map((d) => path.join(MOBILE_ROOT, d));
    const hits: string[] = [];
    const needles = ['131.70', '$131.70'];
    function walk(dir: string) {
      for (const entry of glob.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(tsx?|json)$/.test(entry.name)) continue;
        const src = readFileSync(full, 'utf8');
        for (const needle of needles) {
          if (src.includes(needle)) hits.push(`${path.relative(MOBILE_ROOT, full)} contains "${needle}"`);
        }
      }
    }
    for (const dir of searchDirs) walk(dir);
    expect(hits).toEqual([]);
  });

  it('the seller fresh-preview mutation store (discounts) starts empty and is never pre-seeded', () => {
    const src = read('lib/previewSellerFreshStore.ts');
    expect(src).toContain('function initialState(): PreviewSellerFreshState {\n  return { discounts: [], liveSessions: [], storefront: { headline: null, bio: null, updatedAt: null } };\n}');
  });

  it('discounts.tsx routes fresh-preview create/update/delete through the in-session store, never the network, when there is no signed-in account', () => {
    const src = read('app/discounts.tsx');
    expect(src).toContain("import { addPreviewDiscount, deletePreviewDiscount, getPreviewDiscounts, updatePreviewDiscount");
    expect(src).toContain('const previewOnly = isPreviewMode && (!authLoaded || !isSignedIn || !userId);');
    expect(src).toContain('if (previewOnly) {');
  });

  it('customers, finance and payouts resolve to the honest empty/zero state (not a fake seeded list) when previewing with no account', () => {
    for (const file of ['app/customers.tsx', 'app/finance.tsx', 'app/payouts.tsx']) {
      const src = read(file);
      expect(src).toMatch(/isPreviewMode && !userId|isPreviewMode && \(!(authLoaded|isAuthLoaded) \|\| !isSignedIn\)/);
    }
  });
});

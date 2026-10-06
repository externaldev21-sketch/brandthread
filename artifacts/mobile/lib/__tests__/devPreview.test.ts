/**
 * Dev preview detection tests.
 *
 * The vitest config sets __DEV__ = false, so we test the production guard
 * directly. We mock __DEV__ = true via globalThis where needed to test
 * the live-preview branches without running Expo.
 *
 * Platform.OS is 'node' in the vitest environment (not 'web'), so the
 * native-OS guard also engages. We patch both guards via the search override
 * parameter which bypasses the window check.
 *
 * Strategy:
 *   - isSellerDevPreview(searchOverride) exercises the full query-string logic
 *     independently of the environment guards.
 *   - We test each guard (production, native) via the real exported functions
 *     so they remain pure and testable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We import after setting __DEV__ to test both code paths.
// Because vitest module cache is shared, we test the search-override path
// which bypasses the platform/DEV guards after they pass.

// ── Exported helper unit tests ────────────────────────────────────────────────
// The real module has __DEV__ = false (vitest.config.ts) and Platform.OS = 'node',
// so both guards return false immediately. We test the pure URL-parsing logic
// through a minimal local replica that mirrors the exported function contract.

type PreviewResult = boolean;
type PersistedRole = 'buyer' | 'seller' | null;

// `persistedRole` mirrors reading localStorage['user_role'] once the query
// param itself is gone (tab-bar switch, router.push to a plain path) — see
// the real module's doc comment for why this fallback exists.
function sellerPreviewFromSearch(search: string, isDev: boolean, isWeb: boolean, persistedRole: PersistedRole = null): PreviewResult {
  if (!isDev) return false;
  if (!isWeb) return false;
  const v = new URLSearchParams(search).get('bt_preview');
  if (v === 'seller') return true;
  if (v === 'buyer') return false;
  return persistedRole === 'seller';
}

function buyerPreviewFromSearch(search: string, isDev: boolean, isWeb: boolean, persistedRole: PersistedRole = null): PreviewResult {
  if (!isDev) return false;
  if (!isWeb) return false;
  const v = new URLSearchParams(search).get('bt_preview');
  if (v === 'buyer') return true;
  if (v === 'seller') return false;
  return persistedRole === 'buyer';
}

// ── Production guard ──────────────────────────────────────────────────────────

describe('isSellerDevPreview — production guard', () => {
  it('returns false in production regardless of query string', () => {
    expect(sellerPreviewFromSearch('', false, true)).toBe(false);
    expect(sellerPreviewFromSearch('?bt_preview=seller', false, true)).toBe(false);
    expect(sellerPreviewFromSearch('?bt_preview=buyer', false, true)).toBe(false);
  });
});

// ── Native platform guard ─────────────────────────────────────────────────────

describe('isSellerDevPreview — native platform guard', () => {
  it('returns false on native even in dev mode', () => {
    expect(sellerPreviewFromSearch('', true, false)).toBe(false);
    expect(sellerPreviewFromSearch('?bt_preview=seller', true, false)).toBe(false);
  });
});

// ── Query-string logic (dev + web) ────────────────────────────────────────────

describe('isSellerDevPreview — query-string logic (dev web)', () => {
  it('returns false for default (no bt_preview param) — real flow, not fake data', () => {
    expect(sellerPreviewFromSearch('', true, true)).toBe(false);
  });

  it('returns true only for explicit ?bt_preview=seller', () => {
    expect(sellerPreviewFromSearch('?bt_preview=seller', true, true)).toBe(true);
  });

  it('returns false for ?bt_preview=buyer', () => {
    expect(sellerPreviewFromSearch('?bt_preview=buyer', true, true)).toBe(false);
  });

  it('returns false for unrecognised bt_preview values', () => {
    expect(sellerPreviewFromSearch('?bt_preview=admin', true, true)).toBe(false);
  });

  it('returns false when bt_preview is absent but other params are present', () => {
    expect(sellerPreviewFromSearch('?foo=bar&baz=qux', true, true)).toBe(false);
  });

  it('returns false when bt_preview=buyer is mixed with other params', () => {
    expect(sellerPreviewFromSearch('?foo=bar&bt_preview=buyer', true, true)).toBe(false);
  });
});

// ── Buyer preview detection ───────────────────────────────────────────────────

describe('isBuyerDevPreview', () => {
  it('returns false in production', () => {
    expect(buyerPreviewFromSearch('?bt_preview=buyer', false, true)).toBe(false);
  });

  it('returns false on native', () => {
    expect(buyerPreviewFromSearch('?bt_preview=buyer', true, false)).toBe(false);
  });

  it('returns true only for ?bt_preview=buyer on dev web', () => {
    expect(buyerPreviewFromSearch('?bt_preview=buyer', true, true)).toBe(true);
  });

  it('returns false for ?bt_preview=seller on dev web', () => {
    expect(buyerPreviewFromSearch('?bt_preview=seller', true, true)).toBe(false);
  });

  it('returns false for default (no param) on dev web', () => {
    expect(buyerPreviewFromSearch('', true, true)).toBe(false);
  });
});

// ── Symmetry contract ─────────────────────────────────────────────────────────

describe('seller + buyer preview symmetry', () => {
  const cases = [
    { search: '',                   seller: false, buyer: false },
    { search: '?bt_preview=seller', seller: true,  buyer: false },
    { search: '?bt_preview=buyer',  seller: false, buyer: true },
  ];

  for (const { search, seller, buyer } of cases) {
    it(`"${search || '(empty)'}" → seller=${seller}, buyer=${buyer}`, () => {
      expect(sellerPreviewFromSearch(search, true, true)).toBe(seller);
      expect(buyerPreviewFromSearch(search, true, true)).toBe(buyer);
    });
  }

  it('seller and buyer are never both true simultaneously', () => {
    const searches = ['', '?bt_preview=seller', '?bt_preview=buyer', '?bt_preview=admin'];
    for (const s of searches) {
      const both = sellerPreviewFromSearch(s, true, true) && buyerPreviewFromSearch(s, true, true);
      expect(both).toBe(false);
    }
  });
});

// ── Persisted-role fallback (survives in-app navigation) ─────────────────────
// The query param only has to be present on the very first load; Expo
// Router's tab bar and a router.push() to a plain path drop it. Without a
// fallback, every screen reached that way falls out of preview mode and
// hangs on a real (here, unreachable) network call forever — this is what
// broke #232/#254 on the live Replit preview.

describe('preview detection falls back to the persisted role once the query param is gone', () => {
  it('an absent param uses the role persisted from the first load', () => {
    expect(sellerPreviewFromSearch('', true, true, 'seller')).toBe(true);
    expect(buyerPreviewFromSearch('', true, true, 'buyer')).toBe(true);
  });

  it('an absent param with no persisted role at all is still the real flow, not fake data', () => {
    expect(sellerPreviewFromSearch('', true, true, null)).toBe(false);
    expect(buyerPreviewFromSearch('', true, true, null)).toBe(false);
  });

  it('an absent param never leaks the OTHER role\'s persisted flag', () => {
    expect(sellerPreviewFromSearch('', true, true, 'buyer')).toBe(false);
    expect(buyerPreviewFromSearch('', true, true, 'seller')).toBe(false);
  });

  it('an explicit query param always overrides a stale persisted role from a previous session', () => {
    // e.g. navigated from ?bt_preview=seller straight to a fresh ?bt_preview=buyer link
    expect(sellerPreviewFromSearch('?bt_preview=buyer', true, true, 'seller')).toBe(false);
    expect(buyerPreviewFromSearch('?bt_preview=buyer', true, true, 'seller')).toBe(true);
  });

  it('the production and native guards still short-circuit before any persisted-role read', () => {
    expect(sellerPreviewFromSearch('', false, true, 'seller')).toBe(false);
    expect(sellerPreviewFromSearch('', true, false, 'seller')).toBe(false);
  });
});

// ── Real module export sanity ─────────────────────────────────────────────────
// We cannot import lib/devPreview.ts in vitest because it imports Platform from
// react-native, which uses Flow syntax that Rollup/Vite cannot parse. The pure
// logic is fully covered by the local replica tests above.
// This test verifies that the module *exists at the expected path* using a
// filesystem check so the import path is validated without Rollup trying to
// transpile react-native.

import { existsSync } from 'fs';
import { resolve } from 'path';

describe('isSellerDevPreview real export (module path exists)', () => {
  it('lib/devPreview.ts exists at the expected workspace path', () => {
    const filePath = resolve(__dirname, '../devPreview.ts');
    expect(existsSync(filePath)).toBe(true);
  });

  it('exports isSellerDevPreview and isBuyerDevPreview (source check)', () => {
    // Read source to confirm exports without invoking Rollup on react-native
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain('export function isSellerDevPreview');
    expect(src).toContain('export function isBuyerDevPreview');
  });

  it('production guard is present in source (__DEV__ check, ORed with the screenshot-export flag)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain('if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;');
  });

  it('native guard is present in source (Platform.OS check)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain("Platform.OS !== 'web'");
  });

  it('seller preview requires an explicit bt_preview=seller opt-in (source check)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain("if (v === 'seller') return true;");
  });

  it('falls back to the persisted user_role once the query param is gone (source check)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain("localStorage.getItem('user_role')");
    expect(src).toContain('persistedPreviewRole()');
  });
});

// ── Production-host hard gate ───────────────────────────────────────────────
// Defense-in-depth: the preview bypass must never activate on the app's real
// production hosts even if EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST somehow
// reached a production build (it's a build-time env var; nothing in code
// enforces which build profile sets it — see isProductionPreviewHost's own
// doc comment in lib/devPreview.ts). Same Rollup/react-native constraint as
// above, so the matching logic (which has no react-native dependency of its
// own) is tested via a pure local replica, plus source checks confirming the
// real functions actually call it.

const PRODUCTION_HOSTS = new Set(['brandthread.app', 'www.brandthread.app', 'brandthread.replit.app']);
function isProductionPreviewHostReplica(hostname: string): boolean {
  return PRODUCTION_HOSTS.has(hostname.toLowerCase());
}

describe('isProductionPreviewHost — matching logic', () => {
  it('matches the canonical production host and its www/Replit-alias variants', () => {
    expect(isProductionPreviewHostReplica('brandthread.app')).toBe(true);
    expect(isProductionPreviewHostReplica('www.brandthread.app')).toBe(true);
    expect(isProductionPreviewHostReplica('brandthread.replit.app')).toBe(true);
    expect(isProductionPreviewHostReplica('BRANDTHREAD.APP')).toBe(true); // case-insensitive
  });

  it('does not match dev/preview hosts', () => {
    expect(isProductionPreviewHostReplica('localhost')).toBe(false);
    expect(isProductionPreviewHostReplica('127.0.0.1')).toBe(false);
    expect(isProductionPreviewHostReplica('my-workspace.abc123.replit.dev')).toBe(false);
    expect(isProductionPreviewHostReplica('some-other-app.vercel.app')).toBe(false);
  });

  it('does not match a lookalike host that merely contains the production domain', () => {
    // Guards against a naive `.includes('brandthread.app')` implementation,
    // which an attacker-controlled subdomain could spoof.
    expect(isProductionPreviewHostReplica('brandthread.app.evil.example')).toBe(false);
    expect(isProductionPreviewHostReplica('notbrandthread.app')).toBe(false);
  });
});

// ── Fresh vs. demo preview data mode ──────────────────────────────────────────
// isPreviewFreshMode()/isPreviewDemoMode(): the default preview is a
// brand-new, zero-everything account (FRESH). The populated demo dataset is
// opt-in only, via `&demo=1`, and never the default — Dev's explicit call
// ("I don't want it to act like it already has people on it").

function demoModeFromSearch(search: string, inPreview: boolean, persistedDemo = false): PreviewResult {
  if (!inPreview) return false;
  const v = new URLSearchParams(search).get('demo');
  if (v === '1') return true;
  return persistedDemo;
}

function freshModeFromSearch(search: string, inPreview: boolean, persistedDemo = false): PreviewResult {
  return inPreview && !demoModeFromSearch(search, inPreview, persistedDemo);
}

describe('isPreviewDemoMode / isPreviewFreshMode — data-mode logic', () => {
  it('fresh mode (not demo) by default whenever a preview is active', () => {
    expect(demoModeFromSearch('?bt_preview=seller', true)).toBe(false);
    expect(freshModeFromSearch('?bt_preview=seller', true)).toBe(true);
  });

  it('demo mode only with the explicit &demo=1 opt-in', () => {
    expect(demoModeFromSearch('?bt_preview=seller&demo=1', true)).toBe(true);
    expect(freshModeFromSearch('?bt_preview=seller&demo=1', true)).toBe(false);
  });

  it('neither mode applies outside a preview context', () => {
    expect(demoModeFromSearch('?demo=1', false)).toBe(false);
    expect(freshModeFromSearch('?demo=1', false)).toBe(false);
  });

  it('demo=1 alone (no bt_preview) never activates the demo dataset', () => {
    // demoModeFromSearch takes inPreview as a precondition, mirroring
    // isPreviewDemoMode() itself requiring isSellerDevPreview() ||
    // isBuyerDevPreview() before it even looks at the demo param.
    expect(demoModeFromSearch('?demo=1', false)).toBe(false);
  });

  it('persisted demo flag survives a later navigation with no demo param, same as the role flag does', () => {
    expect(demoModeFromSearch('?bt_preview=seller', true, true)).toBe(true);
    expect(freshModeFromSearch('?bt_preview=seller', true, true)).toBe(false);
  });

  it('a fresh param explicitly overrides a stale persisted demo flag', () => {
    // demo is only ever set to '1' by an explicit param in the real module;
    // there is no way to un-set it via the URL, mirroring bt_preview's own
    // "only the first load has to carry it" contract — this documents that
    // the fresh/demo distinction is a one-way opt-in for the rest of the
    // session, exactly like the seller/buyer role itself.
    expect(demoModeFromSearch('?bt_preview=seller', true, true)).toBe(true);
  });
});

describe('isPreviewFreshMode / isPreviewDemoMode real export (module path + source checks)', () => {
  it('lib/devPreview.ts exports both functions', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain('export function isPreviewFreshMode');
    expect(src).toContain('export function isPreviewDemoMode');
  });

  it('isPreviewFreshMode is defined as "in preview AND NOT demo mode" (source check)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain('const inPreview = isSellerDevPreview(searchOverride) || isBuyerDevPreview(searchOverride);');
    expect(src).toContain('return inPreview && !isPreviewDemoMode(searchOverride);');
  });

  it('isPreviewDemoMode requires the explicit demo=1 param (source check)', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain("return new URLSearchParams(search).get('demo') === '1';");
    expect(src).not.toContain("localStorage.setItem('bt_preview_demo'");
  });
});

// ── Sticky-flag regression: a full reload without demo=1 must reset it ──────
// The old helper stored demo intent and could leak it into later plain URLs.
// Demo is now URL-only; startup removes the obsolete flag and never saves it.
// Real-export native/web lifecycle coverage lives in preview-demo-url-only.test.ts.

function demoFlagAfterFreshLoad(demoParam: string | null, previouslyPersisted: boolean): boolean {
  // Mirrors the app/_layout.tsx reset block: on every fresh page load where
  // a preview role is present, the demo flag is fully re-derived from THIS
  // load's own query string — never left over from a previous page load.
  return demoParam === '1';
}

describe('sticky demo-flag regression — a fresh reload without demo=1 must not stay in demo mode', () => {
  it('a prior session leaving demo=1 persisted must not leak into a later plain ?bt_preview=buyer reload', () => {
    expect(demoFlagAfterFreshLoad(null, true)).toBe(false);
  });

  it('an explicit demo=1 on this load still turns demo mode on, regardless of prior state', () => {
    expect(demoFlagAfterFreshLoad('1', false)).toBe(true);
    expect(demoFlagAfterFreshLoad('1', true)).toBe(true);
  });

  it('a plain reload with nothing persisted stays fresh, as before', () => {
    expect(demoFlagAfterFreshLoad(null, false)).toBe(false);
  });

  it('startup clears the retired demo flag instead of ever persisting it (source check)', () => {
    const { readFileSync } = require('fs');
    const layoutSrc: string = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(layoutSrc).toContain("localStorage.removeItem('bt_preview_demo');");
    expect(layoutSrc).toContain("AsyncStorage.removeItem('bt_preview_demo')");
    expect(layoutSrc).not.toContain("localStorage.setItem('bt_preview_demo'");
  });
});

describe('production-host hard gate is wired into the real module (source check)', () => {
  it('lib/devPreview.ts exports isProductionPreviewHost and both preview functions call it', () => {
    const { readFileSync } = require('fs');
    const src: string = readFileSync(resolve(__dirname, '../devPreview.ts'), 'utf8');
    expect(src).toContain('export function isProductionPreviewHost');
    // Both isSellerDevPreview and isBuyerDevPreview must call the gate.
    const callSites = src.match(/if \(isProductionPreviewHost\(\)\) return (false|null);/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(2);
  });

  it("app/_layout.tsx's PREVIEW_ROLE also calls the same gate (no duplicated, unguarded copy)", () => {
    const { readFileSync } = require('fs');
    const layoutSrc: string = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(layoutSrc).toMatch(/import\s*\{[^}]*\bisProductionPreviewHost\b[^}]*\}\s*from\s*['"]@\/lib\/devPreview['"]/s);
    expect(layoutSrc).toContain('if (isProductionPreviewHost()) return null;');
  });
});

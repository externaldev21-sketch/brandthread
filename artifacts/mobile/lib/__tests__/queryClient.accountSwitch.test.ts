/**
 * Regression guard for the account-switch race: the shared TanStack
 * queryClient (lib/queryClient.ts) has never been userId-scoped — its
 * query keys (queryKeys.tabData/orderList/productList) carry no userId of
 * their own, and nothing anywhere in the app called queryClient.clear() /
 * removeQueries() / resetQueries() on sign-out or account switch (grep
 * confirmed zero matches before this fix). Any data an account A screen
 * cached via useQuery would still be readable — for up to gcTime (24h) —
 * after switching straight to account B, with nothing re-scoping it. The
 * fix (app/_layout.tsx's ServiceConfigurer account-switch effect) is a real
 * app/_layout.tsx wiring, so it can't be unit-tested by importing that huge
 * screen file directly — verified here two ways: (1) the queryClient's own
 * .clear() behavior actually empties the cache (the primitive the fix
 * relies on), and (2) a source check confirming the switch effect in
 * app/_layout.tsx actually calls it, in the same block as the other
 * userId-scoped cache clears (clearSocialCache/clearCartCache/
 * clearApiCache), not a separate, possibly-skippable path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '../queryClient';

const ROOT = resolve(__dirname, '../..');

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
  });
}

describe('queryClient.clear() — the primitive the account-switch fix relies on', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('removes data cached under a previous account before the next account can read it', () => {
    // Simulate account A caching a list under an unscoped query key.
    queryClient.setQueryData(['orderList', 'all'], { orders: [{ id: 'order-a-1' }] });
    expect(queryClient.getQueryData(['orderList', 'all'])).toBeDefined();

    // Account switch: the fix clears the whole client.
    queryClient.clear();

    // Account B must never see account A's cached data at the same key.
    expect(queryClient.getQueryData(['orderList', 'all'])).toBeUndefined();
  });

  it('clears every query key, not just one', () => {
    queryClient.setQueryData(['orderList', 'all'], { orders: [] });
    queryClient.setQueryData(['productList', 'all'], { products: [] });
    queryClient.setQueryData(['tabData', 'home'], { widgets: [] });

    queryClient.clear();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('the account-switch effect actually calls queryClient.clear() (source check)', () => {
  it("app/_layout.tsx's ServiceConfigurer clears queryClient in the same block as the other userId-scoped cache clears", () => {
    const src = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');

    const switchBlockMatch = src.match(
      /if \(oldUserId !== null && oldUserId !== newUserId\) \{[\s\S]*?\n {4}\}/,
    );
    expect(switchBlockMatch, 'could not find the account-switch guard block in app/_layout.tsx').toBeTruthy();

    const block = switchBlockMatch![0];
    expect(block).toContain('clearSocialCache(oldUserId)');
    expect(block).toContain('clearCartCache(oldUserId)');
    expect(block).toContain('clearApiCache(oldUserId)');
    // The actual assertion this test exists for: queryClient must be
    // cleared in the SAME guarded block as the other per-user caches, not
    // omitted or left to a separate, possibly-skipped code path.
    expect(block).toContain('queryClient.clear()');
  });
});

describe('unscoped list query keys are never read via useQuery from app screens (lint-style guard)', () => {
  // queryKeys.tabData/orderList/productList carry no userId of their own
  // (unlike queryKeys.profile(userId), which is already scoped). Today
  // nothing reads them via useQuery — every real screen goes through the
  // userId-scoped service singletons (services/*.ts's init*Service/K()
  // pattern) instead; these keys exist only for lib/appStartPrefetch.ts's
  // warmers. If a future screen starts reading queryKeys.tabData(...) /
  // orderList(...) / productList(...) directly via useQuery, it would
  // silently reintroduce the exact leak queryClient.clear() on switch
  // doesn't fully close on its own (a query issued moments before the
  // clear can still repopulate the cache under the OLD account's data if
  // its response lands after the clear but is keyed identically for the
  // new account) — so this is intentionally strict: flag it here and make
  // a human confirm it's userId-scoped before adding the usage, rather
  // than let it slip in silently.
  it('no app/ or components/ file calls useQuery(queryKeys.tabData|orderList|productList(...))', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components']) {
      for (const file of listSourceFiles(resolve(ROOT, dir))) {
        const src = readFileSync(file, 'utf8');
        if (/useQuery\s*\(\s*\{?\s*queryKey:\s*queryKeys\.(tabData|orderList|productList)\(/.test(src)
          || /useQuery\s*\(\s*queryKeys\.(tabData|orderList|productList)\(/.test(src)) {
          offenders.push(file.replace(`${ROOT}/`, ''));
        }
      }
    }
    expect(offenders, `found unscoped list-key useQuery usage in: ${offenders.join(', ')} — scope it by userId (e.g. queryKeys.profile-style) before adding, or clear/invalidate it explicitly on account switch`).toEqual([]);
  });
});

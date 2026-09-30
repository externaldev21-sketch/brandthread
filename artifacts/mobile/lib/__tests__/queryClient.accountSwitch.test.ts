/**
 * Regression guard for the account-switch data-bleed risk, and for the
 * "instant switching" requirement added on top of the original fix.
 *
 * History: the shared TanStack queryClient (lib/queryClient.ts) was
 * originally not userId-scoped at all, so app/_layout.tsx's ServiceConfigurer
 * account-switch effect called queryClient.clear() on every switch (same
 * block as clearSocialCache/clearCartCache/clearApiCache) to stop account A's
 * cached data leaking into account B. That closed the bleed, but at the cost
 * of a full clear()+refetch flicker every time — including switching BACK to
 * an account already visited this session.
 *
 * The current fix instead namespaces every relevant cache by userId —
 * lib/queryClient.ts's queryKeys.* (via setQueryKeyScope), and the two
 * instant-first-paint caches lib/tabDataCache.ts / lib/feedPostsCache.ts (via
 * initTabDataCache/initFeedPostsCache) — the same "init*(userId)" pattern
 * services/productService.ts and services/cartService.ts already used.
 * Re-scoping (not clearing) means account A's entries are never evicted,
 * just filed under a key account B can't read — so switching back to A is
 * instant, not a refetch, while still closing the exact same bleed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryClient, queryKeys, setQueryKeyScope } from '../queryClient';

describe('queryKeys.* are namespaced by the scope set via setQueryKeyScope', () => {
  beforeEach(() => {
    queryClient.clear();
    setQueryKeyScope(null);
  });

  it('gives the same key shape different identities for different accounts', () => {
    setQueryKeyScope('user-a');
    const keyForA = queryKeys.orderList('all');
    setQueryKeyScope('user-b');
    const keyForB = queryKeys.orderList('all');

    expect(keyForA).not.toEqual(keyForB);
  });

  it('account B can never read data cached under account A\'s scope at the "same" key', () => {
    setQueryKeyScope('user-a');
    queryClient.setQueryData(queryKeys.orderList('all'), { orders: [{ id: 'order-a-1' }] });
    expect(queryClient.getQueryData(queryKeys.orderList('all'))).toBeDefined();

    setQueryKeyScope('user-b');
    expect(queryClient.getQueryData(queryKeys.orderList('all'))).toBeUndefined();
  });

  it('switching back to account A instantly sees its own data again — nothing was evicted', () => {
    setQueryKeyScope('user-a');
    queryClient.setQueryData(queryKeys.tabData('seller-dashboard'), { widgets: ['real-data'] });

    setQueryKeyScope('user-b');
    expect(queryClient.getQueryData(queryKeys.tabData('seller-dashboard'))).toBeUndefined();

    setQueryKeyScope('user-a');
    expect(queryClient.getQueryData(queryKeys.tabData('seller-dashboard'))).toEqual({ widgets: ['real-data'] });
  });

  it('a signed-out/guest scope (null) is its own distinct namespace, not merged with any account', () => {
    setQueryKeyScope('user-a');
    queryClient.setQueryData(queryKeys.productList('mine'), { products: ['a-product'] });

    setQueryKeyScope(null);
    expect(queryClient.getQueryData(queryKeys.productList('mine'))).toBeUndefined();
  });
});

describe('the account-switch effect wires up every per-account cache scope (source check)', () => {
  it("app/_layout.tsx's ServiceConfigurer calls setQueryKeyScope/initTabDataCache/initFeedPostsCache on every switch, unconditionally (not just inside the changed-user guard)", () => {
    const src = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');

    // Unconditional (outside the `if (oldUserId !== newUserId)` guard, same
    // as initSocialService/initCartService/initProductService) — a cold
    // start's very first render still needs the scope set before anything
    // reads a cache, not only on an actual change.
    expect(src).toContain('setQueryKeyScope(newUserId)');
    expect(src).toContain('initTabDataCache(newUserId)');
    expect(src).toContain('initFeedPostsCache(newUserId)');

    // The old blanket clear() must actually be gone — its presence would
    // mean this is still a clear()+refetch flow, not instant switching.
    expect(src).not.toContain('queryClient.clear()');
  });

  it('still clears the OLD user\'s social/cart/api caches on a real change (data bleed still impossible, not merely slower to appear)', () => {
    const src = readFileSync(resolve(__dirname, '../../app/_layout.tsx'), 'utf8');
    const switchBlockMatch = src.match(
      /if \(oldUserId !== null && oldUserId !== newUserId\) \{[\s\S]*?\n {4}\}/,
    );
    expect(switchBlockMatch, 'could not find the account-switch guard block in app/_layout.tsx').toBeTruthy();

    const block = switchBlockMatch![0];
    expect(block).toContain('clearSocialCache(oldUserId)');
    expect(block).toContain('clearCartCache(oldUserId)');
    expect(block).toContain('clearApiCache(oldUserId)');
  });
});

describe('unscoped list query keys are never read via useQuery from app screens (lint-style guard)', () => {
  // queryKeys.tabData/orderList/productList are namespaced (see above), but
  // nothing in the app reads them via useQuery today — every real screen
  // goes through the userId-scoped service singletons (services/*.ts's
  // init*Service/keys() pattern) instead; these factories exist only for
  // lib/appStartPrefetch.ts's warmers. Kept as a guard so a future screen
  // adding direct useQuery(queryKeys.tabData(...)) usage gets a human to
  // confirm it's still correctly scoped, rather than slipping in silently.
  const ROOT = resolve(__dirname, '../..');
  function listSourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry: string) => {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) return listSourceFiles(full);
      return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
    });
  }

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
    expect(offenders, `found unscoped list-key useQuery usage in: ${offenders.join(', ')} — confirm it stays userId-scoped before adding, or clear/invalidate it explicitly on account switch`).toEqual([]);
  });
});

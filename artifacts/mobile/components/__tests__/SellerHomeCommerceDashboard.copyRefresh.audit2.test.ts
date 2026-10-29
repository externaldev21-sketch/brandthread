/**
 * Source-structure test (last resort: the full dashboard pulls in dozens of
 * native-only modules and can't be rendered under the Node shim).
 *
 * 1. Copying the store URL showed the "copied" checkmark even when the
 *    clipboard write rejected (and the rejection went unhandled), and the
 *    1.2s reset timer was never cleared on unmount.
 * 2. Pull-to-refresh both called loadSecondaryData() and bumped retryTick,
 *    whose effect called loadSecondaryData() again — every pull fetched the
 *    orders/products/returns/... set twice, concurrently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  process.env.AUDIT2_DASHBOARD_SRC ?? join(__dirname, '..', 'SellerHomeCommerceDashboard.tsx'),
  'utf8',
);

function between(start: string, end: string): string {
  const a = source.indexOf(start);
  expect(a).toBeGreaterThan(-1);
  const b = source.indexOf(end, a);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

describe('SellerHomeCommerceDashboard — copy store URL', () => {
  it('only flips to "copied" after the clipboard write succeeds, and handles a rejection', () => {
    const fn = between('const handleCopyStoreUrl = useCallback(', '}, [storeUrl, api, isSignedIn, sellerPreview]);');
    const write = fn.indexOf('Clipboard.setStringAsync(storeUrl)');
    const copied = fn.indexOf('setStoreUrlCopied(true)');
    expect(fn).toMatch(/try \{[\s\S]*Clipboard\.setStringAsync\(storeUrl\)[\s\S]*\} catch/);
    expect(copied).toBeGreaterThan(write);
    // Not set synchronously outside the async block.
    expect(fn.slice(fn.lastIndexOf('})();'))).not.toContain('setStoreUrlCopied(true)');
  });

  it('clears the checkmark reset timer on unmount', () => {
    expect(source).toContain('copiedTimerRef.current = setTimeout(() => setStoreUrlCopied(false), 1200)');
    expect(source).toMatch(/useEffect\(\(\) => \(\) => \{ if \(copiedTimerRef\.current\) clearTimeout\(copiedTimerRef\.current\); \}, \[\]\)/);
  });
});

describe('SellerHomeCommerceDashboard — pull to refresh', () => {
  it('does not load the secondary data twice (direct call + retryTick effect)', () => {
    const effect = between('useEffect(() => {\n    const covered', '}, [loadSecondaryData, retryTick, storeContextTick]);');
    expect(effect).toMatch(/if \(covered\) return;[\s\S]*void loadSecondaryData\(\);/);
    const refresh = between('const onRefresh = useCallback(async () => {', '}, [loadFinanceBalance, loadSecondaryData, reloadThreadCash]);');
    const mark = refresh.indexOf('secondaryCoveredRef.current = `${ticksRef.current.retryTick + 1}:${ticksRef.current.storeContextTick}`');
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(refresh.indexOf('setRetryTick((n) => n + 1)'));
  });
});

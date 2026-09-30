import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** `guard` must appear after `anchor` and before the first `call` after `anchor`. */
function before(src: string, anchor: string, guard: string, call: string) {
  const a = src.indexOf(anchor);
  expect(a, `anchor ${anchor}`).toBeGreaterThan(-1);
  const g = src.indexOf(guard, a);
  const c = src.indexOf(call, a);
  expect(g, `guard ${guard}`).toBeGreaterThan(-1);
  expect(c, `call ${call}`).toBeGreaterThan(-1);
  expect(g).toBeLessThan(c);
}

describe('seller screens make no protected API call when signed out / Clerk not loaded', () => {
  it('(tabs)/index.tsx gates setup load and child mount on a loaded, signed-in session', () => {
    const s = read('app/(tabs)/index.tsx');
    expect(s).toContain('if (!isLoaded || !isSignedIn || !userId) {');
    expect(s).toContain('if ((!isLoaded || !isSignedIn || !userId) && !isSellerDevPreview()) {');
    before(s, 'useEffect(() => {', '!isLoaded || !isSignedIn', 'void loadSetup()');
    before(s, 'if ((!isLoaded', 'return <View style={styles.root} />', '<SellerHomeCommerceDashboard');
  });

  it('products.tsx: signed-out preview loads nothing and blocks mutations', () => {
    const s = read('app/(tabs)/products.tsx');
    expect(s).toContain('const previewOnly = sellerPreview && (!authLoaded || !isSignedIn || !userId);');
    before(s, 'const loadStats = useCallback', 'if (previewOnly || previewOnlyRef.current)', 'await getProductStats()');
    before(s, 'const loadProducts = useCallback', 'if (previewOnly || previewOnlyRef.current)', 'await getProducts(');
    before(s, 'async function handleDuplicate(id: string)', 'if (previewOnly)', 'await duplicateProduct');
    before(s, 'async function handleDelete(product: Product)', 'if (previewOnly)', 'Alert.alert(');
    before(s, 'async function handleQuickArchive(product: Product)', 'if (previewOnly)', 'await ');
  });

  it('discounts.tsx: preview waits for a loaded session before reading or writing', () => {
    const s = read('app/discounts.tsx');
    expect(s).toContain('const previewOnly = isPreviewMode && (!authLoaded || !isSignedIn || !userId);');
    before(s, 'const loadDiscounts = useCallback', 'if (previewOnly)', 'api.');
    expect(s).not.toContain('isPreviewMode && !userId');
  });

  it('finance.tsx: skips summary/balance/transactions reads', () => {
    const s = read('app/finance.tsx');
    expect(s).toContain('const skipProtectedReads = isSignedOutSellerPreview;');
    expect(s).toContain('(!isAuthLoaded || !isSignedIn)');
    before(s, 'const load = useCallback', 'if (skipProtectedReads)', 'api.');
    expect(s).toContain('[api, skipProtectedReads]');
  });

  it('payouts.tsx: skips balance, payouts, connect status and onboarding', () => {
    const s = read('app/payouts.tsx');
    expect(s).toContain('(!authLoaded || !isSignedIn)');
    before(s, 'const refreshConnectStatus = useCallback', 'if (isPreview)', 'api.');
    before(s, 'const load = useCallback', 'if (isPreview)', 'api.');
    before(s, 'const openConnectOnboarding = useCallback', 'if (isPreview) return;', 'api.');
  });

  it('subscription.tsx: skips status fetch, focus refresh, app-state poll and billing actions', () => {
    const s = read('app/subscription.tsx');
    expect(s).toContain('isSellerDevPreview() && (!authLoaded || !isSignedIn || !userId)');
    before(s, 'const fetchStatus = useCallback', 'if (isSellerPreview)', 'api.seller.subscription.status()');
    for (const fn of ['handleChangePlan', 'handleOpenPortal', 'handleRestore']) {
      before(s, `async function ${fn}`, 'if (isSellerPreview) return;', 'haptic()');
    }
  });

  it('StripeConnectWarning.tsx: refresh and connect require a signed-in session', () => {
    const s = read('components/StripeConnectWarning.tsx');
    before(s, 'const refreshConnectStatus = useCallback', '!isSignedIn', 'api.');
    before(s, 'const handleFixStripeConnect', '!isSignedIn', 'api.');
  });

  it('hooks gate on the Clerk session', () => {
    expect(read('hooks/useTeamRole.ts')).toContain('if (!isLoaded || !isSignedIn) {');
    expect(read('hooks/useSubscriptionPlan.ts')).toContain('if (!isSignedIn || !userId) {');
  });
});

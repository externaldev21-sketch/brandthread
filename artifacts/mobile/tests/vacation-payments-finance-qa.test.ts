/**
 * Source-level regressions for QA-0172/0173 (vacation mode), QA-0121
 * (payments), QA-0090 (finance statement) and QA-0140 (ip-report clearance).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

function before(src: string, anchor: string, guard: string, call: string) {
  const a = src.indexOf(anchor);
  expect(a, `anchor ${anchor}`).toBeGreaterThan(-1);
  const g = src.indexOf(guard, a);
  const c = src.indexOf(call, a);
  expect(g, `guard ${guard}`).toBeGreaterThan(-1);
  expect(c, `call ${call}`).toBeGreaterThan(-1);
  expect(g).toBeLessThan(c);
}

describe('vacation-mode.tsx', () => {
  const s = read('app/vacation-mode.tsx');

  it('QA-0172: Save label uses onAccent, never hardcoded white on the white accent', () => {
    expect(s).toMatch(/saveBtnText:\{[^}]*color: theme\.onAccent/);
    expect(s).not.toMatch(/saveBtnText:\{[^}]*'#fff'/);
  });

  it('QA-0173: load errors surface an ErrorState with retry instead of defaults', () => {
    expect(s).not.toContain('.catch(() => {})');
    expect(s).toContain('.catch(() => setLoadError(true))');
    expect(s).toContain('<ErrorState message="Couldn\'t load your vacation settings." onRetry={load} />');
  });

  it('QA-0173: Save is blocked while loading, after a load error, and in signed-out preview', () => {
    expect(s).toContain('const saveDisabled = saving || loading || loadError || skipProtectedReads;');
    expect(s).toContain('disabled={saveDisabled}');
    before(s, 'async function handleSave()', 'if (loading || loadError || skipProtectedReads) return;', 'vacation?.update');
  });

  it('signed-out preview never calls the protected vacation API', () => {
    before(s, 'const load = useCallback', 'if (skipProtectedReads)', 'seller.vacation.get()');
    expect(s).toContain('(!isAuthLoaded || !isSignedIn)');
  });
});

describe('payments.tsx (QA-0121)', () => {
  const s = read('app/payments.tsx');

  it('skips the protected drops read in signed-out preview', () => {
    before(s, 'const load = useCallback', 'if (skipProtectedReads)', 'api.drops.list()');
    expect(s).toContain('[api, skipProtectedReads]');
  });

  it('names the failed content and reads the real collected-cents field', () => {
    expect(s).toContain('Couldn\'t load drop payouts');
    expect(s).toContain('d.totalCollectedCents ?? d.totalCents ?? 0');
  });
});

describe('finance.tsx (QA-0090)', () => {
  const s = read('app/finance.tsx');

  it('downloads the statement through an authenticated fetch, not a bare URL', () => {
    expect(s).not.toMatch(/Linking\.openURL\(url\)/);
    expect(s).toContain('token: await getToken()');
    expect(s).toContain('fetchStatementCsv(');
    expect(s).toContain('saveCsvFile(');
  });

  it('surfaces download failures instead of swallowing them', () => {
    expect(s).not.toContain('catch { /* ignore */ }');
    expect(s).toContain('setStatementError(statementErrorLabel(err))');
    expect(s).toContain('<RetryRow label={statementError}');
  });
});

describe('ip-report.tsx (QA-0140)', () => {
  it('pads the scroll content past the floating tab bar', () => {
    const s = read('app/ip-report.tsx');
    expect(s).toContain('COMP.tabBarH');
    expect(s).toContain('paddingBottom: tabBarClearance');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-structure test (last resort): RevenueCatProvider needs the native
// store SDK, Clerk and the API client, none of which render under Vitest.
describe('RevenueCatProvider start-up effect cleanup (audit)', () => {
  const source = readFileSync(resolve(__dirname, 'revenueCat.native.tsx'), 'utf8');
  const effect = source.slice(source.indexOf('const generation = sessionGuard.begin();'), source.indexOf('const purchase = useCallback('));

  it('marks the effect disposed on cleanup', () => {
    expect(effect).toMatch(/return \(\) => \{\s*disposed = true;/);
  });

  it('checks disposal before adding the SDK listener and before every state update', () => {
    expect(effect).toContain('const live = () => !disposed && sessionGuard.isCurrent(generation);');
    const addAt = effect.indexOf('Purchases!.addCustomerInfoUpdateListener(listener)');
    const guardAt = effect.indexOf('if (!live()) return;');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(addAt);
    expect(effect).not.toMatch(/if \(!sessionGuard\.isCurrent\(generation\)\) return;/);
  });
});

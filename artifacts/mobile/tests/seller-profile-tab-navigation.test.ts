import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('seller Profile tab navigation', () => {
  it('uses the seller route group instead of the ambiguous /profile URL', () => {
    // The seller tab bar was extracted to SellerGlobalTabBar.tsx (global shell).
    // The profile destination is '/(tabs)/profile' in the tab definitions.
    const tabBar = readFileSync(resolve(process.cwd(), 'components/SellerGlobalTabBar.tsx'), 'utf8');

    expect(tabBar).toContain("'/(tabs)/profile'");
    expect(tabBar).toContain("router.replace(tabDef.destination as never)");
  });
});
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/SellerHomeCommerceDashboard.tsx', import.meta.url), 'utf8');

describe('seller dashboard tab-bar clearance', () => {
  it('uses the shared seller metrics to reserve the scroll viewport, not just its last item', () => {
    expect(source).toContain('useTabBarClearance(2)');
    expect(source).toContain('marginBottom: Math.max(0, tabBarClearance - SP.md)');
    expect(source).toContain('paddingBottom: SP.md');
  });

  it('does not require a per-screen navigator for the development preview', () => {
    expect(source).not.toContain('useIsFocused');
    expect(source).toContain('setScreenFocused(false)');
  });
});

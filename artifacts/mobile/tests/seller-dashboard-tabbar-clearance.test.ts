import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../components/SellerHomeCommerceDashboard.tsx', import.meta.url), 'utf8');

describe('seller dashboard tab-bar clearance', () => {
  it('keeps the full scroll viewport and pads the content by the seller bar plus 24', () => {
    expect(source).toContain('useTabBarMetrics(2)');
    expect(source).toContain('style={styles.scrollView}');
    expect(source).not.toContain('marginBottom: Math.max(0, tabBarClearance - SP.md)');
    expect(source).toContain('paddingBottom: tabBarMetrics.occupiedHeight + 24');
  });

  it('does not require a per-screen navigator for the development preview', () => {
    expect(source).not.toContain('useIsFocused');
    expect(source).toContain('setScreenFocused(false)');
  });
});

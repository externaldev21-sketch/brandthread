import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let bottomInset = 0;
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 390, height: 844 }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: bottomInset, left: 0, right: 0 }) }));

import { getBuyerTabBarMetrics, useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';

/**
 * Nothing may end under the floating tab bar. Every tab-root screen pads the
 * end of its scroll content with the ONE shared clearance,
 * `useTabBarClearance()` (bar height + bottom safe inset + gap), instead of
 * its own arithmetic on `occupiedHeight` / `useBuyerTabBarInset()`. The
 * profile tabs size their empty state from the bar inset through
 * `computeEmptyArea` (tested in their own suites) and the buyer Home feed is
 * a full-bleed video pager, so neither is listed here.
 */
const TAB_ROOTS = [
  'components/SellerHomeCommerceDashboard.tsx', // seller Dashboard ((tabs)/index)
  'app/(tabs)/orders.tsx',
  'app/(tabs)/products.tsx',
  'app/(tabs)/more.tsx',
  'app/(tabs)/studio.tsx',
  'components/analytics/InsightFrame.tsx', // (tabs)/analytics via useReportBottomInset
  'app/(buyer)/discover.tsx',
  'app/(buyer)/inbox.tsx',
  'app/activity-center.tsx', // (buyer)/activity re-exports it
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('tab-root screens clear the floating tab bar', () => {
  it.each(TAB_ROOTS)('%s pads its scroll end with useTabBarClearance', (file) => {
    const src = read(file);
    expect(src).toMatch(/useTabBarClearance\(/);
    // No hand-rolled bottom padding from the bar's raw geometry.
    expect(src).not.toMatch(/paddingBottom:\s*(tabBar|tabBarMetrics)\.occupiedHeight\s*\+/);
    expect(src).not.toMatch(/paddingBottom:\s*barInset\s*\+/);
  });

  it('the seller Dashboard scroll uses the shared clearance for its last card', () => {
    const src = read('components/SellerHomeCommerceDashboard.tsx');
    expect(src).toMatch(/const tabBarClearance = useTabBarClearance\(2\)/);
    expect(src).toMatch(/testID="seller-dashboard-scroll"[\s\S]{0,300}paddingBottom: tabBarClearance/);
  });

  it('the clearance is taller than the bar on a notched phone and a home-button phone', () => {
    for (const inset of [0, 34]) {
      bottomInset = inset;
      const m = getBuyerTabBarMetrics({ width: 390, height: 844, bottomInset: inset, sideCircleCount: 2 });
      // Hooks here only read the mocked insets/dimensions, so they can be called directly.
      const clearance = useTabBarClearance(2);
      expect(clearance).toBeGreaterThan(m.barTopInset);
      expect(clearance - m.barTopInset).toBeGreaterThanOrEqual(16);
    }
  });
});

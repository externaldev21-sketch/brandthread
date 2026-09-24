import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 393, height: 852 }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));

import { getBuyerTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';

const DEVICES = {
  iphoneSE: { width: 375, height: 667, bottomInset: 0 },
  iphone15: { width: 393, height: 852, bottomInset: 34 },
  iphoneProMax: { width: 440, height: 956, bottomInset: 34 },
  androidGesture: { width: 412, height: 915, bottomInset: 24 },
  androidButtons: { width: 360, height: 800, bottomInset: 48 },
  ipadPortrait: { width: 820, height: 1180, bottomInset: 20 },
  ipadLandscape: { width: 1180, height: 820, bottomInset: 20 },
  ipadSplitNarrow: { width: 320, height: 1180, bottomInset: 20 },
} as const;

// Buyer: capsule + Profile circle. Seller: Studio circle + capsule + AI circle.
const buyerRowWidth = (m: ReturnType<typeof getBuyerTabBarMetrics>) => m.capsuleWidth + m.gap + m.circleSize;
const sellerRowWidth = (m: ReturnType<typeof getBuyerTabBarMetrics>) => m.capsuleWidth + (m.gap + m.circleSize) * 2;

describe('buyer tab bar metrics', () => {
  it('spans nearly the full screen width on phones, like a wide Instagram-style capsule', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphone15, DEVICES.iphoneProMax, DEVICES.androidGesture, DEVICES.androidButtons]) {
      const buyer = getBuyerTabBarMetrics({ ...device, sideCircleCount: 1 });
      const seller = getBuyerTabBarMetrics({ ...device, sideCircleCount: 2 });
      expect(buyer.isTablet).toBe(false);
      // ~16pt margin each side means the bar occupies most of the screen.
      expect(buyerRowWidth(buyer) / device.width).toBeGreaterThanOrEqual(0.85);
      expect(sellerRowWidth(seller) / device.width).toBeGreaterThanOrEqual(0.85);
      // Never touches or overflows the screen edges.
      expect((device.width - buyerRowWidth(buyer)) / 2).toBeGreaterThanOrEqual(12);
      expect((device.width - sellerRowWidth(seller)) / 2).toBeGreaterThanOrEqual(12);
    }
  });

  it('spreads the four slots evenly across the capsule for both bars', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphone15, DEVICES.iphoneProMax, DEVICES.androidGesture, DEVICES.androidButtons]) {
      for (const sideCircleCount of [1, 2]) {
        const m = getBuyerTabBarMetrics({ ...device, sideCircleCount });
        expect(m.capsuleWidth).toBeCloseTo(m.itemWidth * 4 + m.capsulePadding * 2, 5);
      }
    }
  });

  it('gives the seller bar a narrower capsule than the buyer bar (one more side circle)', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphone15, DEVICES.iphoneProMax]) {
      const buyer = getBuyerTabBarMetrics({ ...device, sideCircleCount: 1 });
      const seller = getBuyerTabBarMetrics({ ...device, sideCircleCount: 2 });
      expect(seller.capsuleWidth).toBeLessThan(buyer.capsuleWidth);
      // Both bars still reach the same outer screen margins.
      expect((device.width - buyerRowWidth(buyer)) / 2).toBeCloseTo((device.width - sellerRowWidth(seller)) / 2, 0);
    }
  });

  it('keeps every control at least 44pt and the circle as tall as the capsule', () => {
    for (const device of Object.values(DEVICES)) {
      for (const sideCircleCount of [1, 2]) {
        const m = getBuyerTabBarMetrics({ ...device, sideCircleCount });
        expect(m.itemWidth).toBeGreaterThanOrEqual(44);
        expect(m.capsuleHeight).toBeGreaterThanOrEqual(44);
        expect(m.fieldHeight).toBeGreaterThanOrEqual(40);
        expect(m.circleSize).toBe(m.capsuleHeight);
        expect(m.indicatorHeight).toBeGreaterThanOrEqual(36);
        expect(m.indicatorWidth).toBeLessThanOrEqual(m.itemWidth);
      }
    }
  });

  it('gives the search field ample room inside the already-wide capsule', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphoneProMax, DEVICES.androidButtons, DEVICES.ipadSplitNarrow]) {
      const m = getBuyerTabBarMetrics({ ...device, sideCircleCount: 1 });
      // The capsule no longer needs to grow for search — it's already wide.
      expect(m.searchCapsuleWidth).toBe(m.capsuleWidth);
      // The field (everything right of Home) stays roomy enough to type in.
      expect(m.searchCapsuleWidth - m.capsulePadding * 2 - m.itemWidth).toBeGreaterThanOrEqual(180);
    }
  });

  it('gives iPad its own larger, centred, capped-width proportions in both orientations', () => {
    for (const device of [DEVICES.ipadPortrait, DEVICES.ipadLandscape]) {
      const m = getBuyerTabBarMetrics({ ...device, sideCircleCount: 1 });
      const phone = getBuyerTabBarMetrics({ ...DEVICES.iphoneProMax, sideCircleCount: 1 });
      expect(m.isTablet).toBe(true);
      expect(m.itemWidth).toBeGreaterThan(phone.itemWidth);
      expect(m.capsuleHeight).toBeGreaterThan(phone.capsuleHeight);
      // Capped well short of the huge iPad width — centred, not edge to edge.
      expect(buyerRowWidth(m) / device.width).toBeLessThan(0.75);
      expect(buyerRowWidth(m)).toBeLessThanOrEqual(560);
    }
  });

  it('keeps narrow split-view iPad windows on phone proportions', () => {
    expect(getBuyerTabBarMetrics(DEVICES.ipadSplitNarrow).isTablet).toBe(false);
  });

  it('floats over the home indicator and reports the full area screens must clear', () => {
    const se = getBuyerTabBarMetrics(DEVICES.iphoneSE);
    const x = getBuyerTabBarMetrics(DEVICES.iphone15);
    const android = getBuyerTabBarMetrics(DEVICES.androidButtons);
    expect(se.bottomOffset).toBe(12);
    expect(x.bottomOffset).toBe(24);
    expect(android.bottomOffset).toBeGreaterThanOrEqual(DEVICES.androidButtons.bottomInset - 10);
    for (const m of [se, x, android]) {
      expect(m.occupiedHeight).toBeGreaterThan(m.bottomOffset + m.capsuleHeight);
    }
  });
});

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

const totalWidth = (m: ReturnType<typeof getBuyerTabBarMetrics>) => m.capsuleWidth + m.gap + m.circleSize;
// Seller: Studio circle · capsule · AI circle, from the same metrics.
const sellerWidth = (m: ReturnType<typeof getBuyerTabBarMetrics>) => m.capsuleWidth + (m.gap + m.circleSize) * 2;

describe('buyer tab bar metrics', () => {
  it('sizes the phone bar to its content instead of stretching edge to edge', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphone15, DEVICES.iphoneProMax, DEVICES.androidGesture, DEVICES.androidButtons]) {
      const m = getBuyerTabBarMetrics(device);
      const ratio = totalWidth(m) / device.width;
      expect(m.isTablet).toBe(false);
      expect(ratio).toBeLessThanOrEqual(0.9);
      expect(ratio).toBeGreaterThanOrEqual(0.6);
      expect(m.capsuleWidth).toBe(m.itemWidth * 4 + m.capsulePadding * 2);
    }
  });

  it('fits the wider seller bar on every phone with at least 12pt side margins', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphone15, DEVICES.iphoneProMax, DEVICES.androidGesture, DEVICES.androidButtons, DEVICES.ipadSplitNarrow]) {
      const m = getBuyerTabBarMetrics(device);
      expect((device.width - sellerWidth(m)) / 2).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps every control at least 44pt and the circle as tall as the capsule', () => {
    for (const device of Object.values(DEVICES)) {
      const m = getBuyerTabBarMetrics(device);
      expect(m.itemWidth).toBeGreaterThanOrEqual(44);
      expect(m.capsuleHeight).toBeGreaterThanOrEqual(44);
      expect(m.fieldHeight).toBeGreaterThanOrEqual(40);
      expect(m.circleSize).toBe(m.capsuleHeight);
      expect(m.indicatorHeight).toBeGreaterThanOrEqual(36);
      expect(m.indicatorWidth).toBeLessThanOrEqual(m.itemWidth);
    }
  });

  it('widens the capsule for search on phones without leaving the screen margins', () => {
    for (const device of [DEVICES.iphoneSE, DEVICES.iphoneProMax, DEVICES.androidButtons, DEVICES.ipadSplitNarrow]) {
      const m = getBuyerTabBarMetrics(device);
      expect(m.searchCapsuleWidth).toBeGreaterThan(m.capsuleWidth);
      expect(m.searchCapsuleWidth + m.gap + m.circleSize).toBeLessThanOrEqual(device.width - 24);
      // The field (everything right of Home) stays roomy enough to type in.
      expect(m.searchCapsuleWidth - m.capsulePadding * 2 - m.itemWidth).toBeGreaterThanOrEqual(180);
    }
  });

  it('gives iPad its own larger, centred proportions and a wider search field in both orientations', () => {
    for (const device of [DEVICES.ipadPortrait, DEVICES.ipadLandscape]) {
      const m = getBuyerTabBarMetrics(device);
      const phone = getBuyerTabBarMetrics(DEVICES.iphoneProMax);
      expect(m.isTablet).toBe(true);
      expect(m.itemWidth).toBeGreaterThan(phone.itemWidth);
      expect(m.capsuleHeight).toBeGreaterThan(phone.capsuleHeight);
      expect(totalWidth(m) / device.width).toBeLessThan(0.6);
      expect(m.searchCapsuleWidth).toBeGreaterThan(m.capsuleWidth);
      expect(m.searchCapsuleWidth).toBeLessThanOrEqual(560);
      expect(m.searchCapsuleWidth + m.gap + m.circleSize).toBeLessThanOrEqual(device.width - 96);
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

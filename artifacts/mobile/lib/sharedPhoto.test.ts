import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove() {} }) },
  Dimensions: { get: () => ({ width: 393, height: 852 }) },
  PixelRatio: { get: () => 3 },
  Platform: { OS: 'ios', Version: '18.0' },
}));

import {
  heroRect, isLowEndDevice, isSharedPhotoRoute, openWithSharedPhoto, markSharedPhotoTouched,
  sharedPhoto, startClose, startOpen, usableRect,
} from './sharedPhoto';

const tile = { x: 16, y: 300, width: 172, height: 215 };

beforeEach(() => {
  sharedPhoto.setKillSwitch(true);
  const f = sharedPhoto.current();
  if (f) sharedPhoto.finish(f.id);
});

describe('device and route rules', () => {
  it('treats old or low-density Android as low-end, never iOS', () => {
    expect(isLowEndDevice('android', 28, 3)).toBe(true);
    expect(isLowEndDevice('android', 33, 1.5)).toBe(true);
    expect(isLowEndDevice('android', 33, 2.75)).toBe(false);
    expect(isLowEndDevice('ios', '16.0', 2)).toBe(false);
  });
  it('only morphs into the no-animation product route', () => {
    expect(isSharedPhotoRoute('/thread-product-detail?productId=1')).toBe(true);
    expect(isSharedPhotoRoute({ pathname: '/thread-product-detail' })).toBe(true);
    expect(isSharedPhotoRoute('/buyer-product-detail?productId=1')).toBe(false);
  });
  it('needs a visible, sized tile', () => {
    expect(usableRect(tile, 852)).toBe(true);
    expect(usableRect({ ...tile, width: 0 }, 852)).toBe(false);
    expect(usableRect({ ...tile, y: 900 }, 852)).toBe(false);
    expect(usableRect(null, 852)).toBe(false);
  });
  it('lands on a full-width 3:4 hero', () => {
    expect(heroRect()).toEqual({ x: 0, y: 0, width: 393, height: 524 });
  });
});

describe('open and close', () => {
  it('opens from the tile to the hero, then shrinks back into the same tile', () => {
    expect(startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 12 })).toBe(true);
    const open = sharedPhoto.current()!;
    expect(open).toMatchObject({ kind: 'open', from: tile, to: heroRect(), fromRadius: 12, toRadius: 0 });
    sharedPhoto.finish(open.id);
    expect(startClose('p1', { onFirstPhoto: true, atTop: true })).toBe(true);
    expect(sharedPhoto.current()).toMatchObject({ kind: 'close', from: heroRect(), to: tile, toRadius: 12 });
  });

  it("doesn't shrink back when it would show the wrong picture", () => {
    startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 12 });
    expect(startClose('p1', { onFirstPhoto: false, atTop: true })).toBe(false);
    startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 12 });
    expect(startClose('p1', { onFirstPhoto: true, atTop: false })).toBe(false);
    startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 12 });
    expect(startClose('p2', { onFirstPhoto: true, atTop: true })).toBe(false);
  });

  it('is skipped entirely with the kill switch off', () => {
    sharedPhoto.setKillSwitch(false);
    expect(startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 0 })).toBe(false);
    expect(sharedPhoto.current()).toBeNull();
  });

  it('hands off once the page reports its photo is up', () => {
    startOpen({ productId: 'p1', uri: 'u', rect: tile, radius: 0 });
    expect(sharedPhoto.isHeroReady()).toBe(false);
    sharedPhoto.heroReady('p1');
    expect(sharedPhoto.isHeroReady()).toBe(true);
  });
});

describe('openWithSharedPhoto', () => {
  it('always navigates, morphing only from the touched tile', () => {
    const navigate = vi.fn();
    openWithSharedPhoto('p1', navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(sharedPhoto.current()).toBeNull();

    const node = { measureInWindow: (cb: (...a: number[]) => void) => cb(tile.x, tile.y, tile.width, tile.height) } as any;
    markSharedPhotoTouched({ productId: 'p1', uri: 'u', radius: 8, node });
    openWithSharedPhoto('p1', navigate);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(sharedPhoto.current()).toMatchObject({ kind: 'open', from: tile });
  });

  it('ignores a touch on a different product', () => {
    const navigate = vi.fn();
    const node = { measureInWindow: vi.fn() } as any;
    markSharedPhotoTouched({ productId: 'other', uri: 'u', radius: 8, node });
    openWithSharedPhoto('p1', navigate);
    expect(node.measureInWindow).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

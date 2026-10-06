import { describe, expect, it } from 'vitest';
import { getDisplayCornerRadius, insetOutlineCornerRadius } from '../displayCornerRadius';

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };
const ISLAND = { top: 59, bottom: 34, left: 0, right: 0 };
const NOTCH = { top: 47, bottom: 34, left: 0, right: 0 };
const HOME_BUTTON = { top: 20, bottom: 0, left: 0, right: 0 };

describe('getDisplayCornerRadius — iOS', () => {
  it('maps every current iPhone point size to its display corner radius', () => {
    expect(getDisplayCornerRadius({ width: 393, height: 852, insets: ISLAND, platform: 'ios' })).toBe(55);
    expect(getDisplayCornerRadius({ width: 430, height: 932, insets: ISLAND, platform: 'ios' })).toBe(55);
    expect(getDisplayCornerRadius({ width: 402, height: 874, insets: ISLAND, platform: 'ios' })).toBe(62);
    expect(getDisplayCornerRadius({ width: 440, height: 956, insets: ISLAND, platform: 'ios' })).toBe(62);
    expect(getDisplayCornerRadius({ width: 390, height: 844, insets: NOTCH, platform: 'ios' })).toBe(47);
    expect(getDisplayCornerRadius({ width: 428, height: 926, insets: NOTCH, platform: 'ios' })).toBe(53);
    expect(getDisplayCornerRadius({ width: 375, height: 812, insets: NOTCH, platform: 'ios' })).toBe(39);
    expect(getDisplayCornerRadius({ width: 414, height: 896, insets: NOTCH, platform: 'ios' })).toBe(41);
  });

  it('home-button iPhones are square-cornered', () => {
    expect(getDisplayCornerRadius({ width: 375, height: 667, insets: HOME_BUTTON, platform: 'ios' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 414, height: 736, insets: HOME_BUTTON, platform: 'ios' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 320, height: 568, insets: HOME_BUTTON, platform: 'ios' })).toBe(0);
  });

  it('is orientation-independent (landscape swaps width/height, insets move to the sides)', () => {
    const landscapeInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    expect(getDisplayCornerRadius({ width: 852, height: 393, insets: landscapeInsets, platform: 'ios' })).toBe(55);
    expect(getDisplayCornerRadius({ width: 667, height: 375, insets: NO_INSETS, platform: 'ios' })).toBe(0);
  });

  it('an unknown iPhone size falls back to the smallest notch-family radius when it has a notch inset, else square', () => {
    expect(getDisplayCornerRadius({ width: 400, height: 860, insets: ISLAND, platform: 'ios' })).toBe(39);
    expect(getDisplayCornerRadius({ width: 400, height: 860, insets: HOME_BUTTON, platform: 'ios' })).toBe(0);
  });

  it('iPads: Face ID models (24pt top inset) are 18pt, home-button models (20pt) square — regardless of split-view size', () => {
    const faceId = { top: 24, bottom: 20, left: 0, right: 0 };
    const homeBtn = { top: 20, bottom: 0, left: 0, right: 0 };
    expect(getDisplayCornerRadius({ width: 820, height: 1180, insets: faceId, platform: 'ios' })).toBe(18);
    expect(getDisplayCornerRadius({ width: 1024, height: 1366, insets: faceId, platform: 'ios' })).toBe(18);
    expect(getDisplayCornerRadius({ width: 1366, height: 1024, insets: faceId, platform: 'ios' })).toBe(18);
    expect(getDisplayCornerRadius({ width: 810, height: 1080, insets: homeBtn, platform: 'ios' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 1024, height: 768, insets: homeBtn, platform: 'ios' })).toBe(0);
    // Split view / Stage Manager: a narrower window on a Face ID iPad.
    expect(getDisplayCornerRadius({ width: 639, height: 1180, insets: faceId, platform: 'ios' })).toBe(18);
  });
});

describe('getDisplayCornerRadius — Android / web / unknown', () => {
  it('Android: rounded (24) only when there is a cutout/gesture inset above the classic 24dp status bar', () => {
    expect(getDisplayCornerRadius({ width: 412, height: 915, insets: { top: 48, bottom: 24, left: 0, right: 0 }, platform: 'android' })).toBe(24);
    expect(getDisplayCornerRadius({ width: 360, height: 640, insets: { top: 24, bottom: 0, left: 0, right: 0 }, platform: 'android' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 800, height: 1280, insets: { top: 48, bottom: 0, left: 0, right: 0 }, platform: 'android' })).toBe(0);
  });

  it('web: a phone-sized viewport takes the matching iPhone radius; anything else is a square browser frame', () => {
    expect(getDisplayCornerRadius({ width: 393, height: 852, insets: NO_INSETS, platform: 'web' })).toBe(55);
    expect(getDisplayCornerRadius({ width: 375, height: 667, insets: NO_INSETS, platform: 'web' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 1440, height: 900, insets: NO_INSETS, platform: 'web' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 820, height: 1180, insets: NO_INSETS, platform: 'web' })).toBe(0);
  });

  it('never returns a radius for a zero/invalid window or an unknown platform', () => {
    expect(getDisplayCornerRadius({ width: 0, height: 0, insets: ISLAND, platform: 'ios' })).toBe(0);
    expect(getDisplayCornerRadius({ width: 393, height: 852, insets: ISLAND, platform: 'windows' })).toBe(0);
  });
});

describe('insetOutlineCornerRadius', () => {
  it('is concentric with the glass: display radius minus the inset', () => {
    expect(insetOutlineCornerRadius(55, 8, 393, 852)).toBe(47);
    expect(insetOutlineCornerRadius(18, 8, 820, 1180)).toBe(10);
  });
  it('never goes negative or exceeds half the box', () => {
    expect(insetOutlineCornerRadius(0, 8, 393, 852)).toBe(0);
    expect(insetOutlineCornerRadius(5, 8, 393, 852)).toBe(0);
    expect(insetOutlineCornerRadius(500, 8, 100, 60)).toBe(30);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/lib/skiaAvailability', () => ({ loadSkia: () => null }));

import {
  activeMentionQuery, clampMentionOpacity, clampOverlayPosition, clampOverlayScale, insertMention,
  mentionHitRect, mentionProfileHref, nextMentionStyle, taggedPeople, tapSlop, withAt,
} from './storyMentionSticker';
import { averageRgba, reshareBackground, RESHARE_FALLBACK_COLORS } from './storyReshare';

const canvas = { width: 393, height: 852 };

describe('scale clamping', () => {
  it('lets a mention shrink to 0.05 but keeps 0.4 for everything else', () => {
    expect(clampOverlayScale('mention', 0.001)).toBe(0.05);
    expect(clampOverlayScale('mention', 0.05)).toBe(0.05);
    expect(clampOverlayScale('text', 0.05)).toBe(0.4);
    expect(clampOverlayScale('poll', 0.1)).toBe(0.4);
    expect(clampOverlayScale('mention', 99)).toBe(4);
    expect(clampOverlayScale('mention', NaN)).toBe(1);
  });
  it('can fade a mention nearly out but never below the floor', () => {
    expect(clampMentionOpacity(0)).toBe(0.02);
    expect(clampMentionOpacity(undefined)).toBe(1);
    expect(clampMentionOpacity(5)).toBe(1);
  });
});

describe('position clamping', () => {
  it('keeps the legacy clamp for non-mention overlays', () => {
    expect(clampOverlayPosition('text', { x: -500, y: 5000 }, canvas)).toEqual({ x: -40, y: 832 });
  });
  it('lets a mention sit in a corner, slightly off-canvas, with no snap-back', () => {
    const size = { width: 100, height: 30 };
    const tl = clampOverlayPosition('mention', { x: -47, y: -14 }, canvas, size);
    expect(tl).toEqual({ x: -47, y: -14 }); // centre (3,1) — inside the canvas, untouched
    const off = clampOverlayPosition('mention', { x: -47 - 40, y: -14 - 40 }, canvas, size);
    expect(off.x + 50).toBe(-12); // centre capped a hair off-canvas, never lost
    expect(off.y + 15).toBe(-12);
    const br = clampOverlayPosition('mention', { x: 393 - 50, y: 852 - 15 }, canvas, size);
    expect(br).toEqual({ x: 343, y: 837 });
  });
});

describe('tap targets', () => {
  it('expands a tiny sticker to a 44pt square centred on it', () => {
    const r = mentionHitRect({ x: 100, y: 200, scale: 0.05 }, { width: 100, height: 30 });
    expect(r.width).toBe(44);
    expect(r.height).toBe(44);
    expect(r.left + 22).toBe(150);
    expect(r.top + 22).toBe(215);
  });
  it('does not shrink a large sticker', () => {
    const r = mentionHitRect({ x: 0, y: 0, scale: 2 }, { width: 100, height: 30 });
    expect(r.width).toBe(200);
    expect(r.height).toBe(60);
  });
  it('gives the editor enough unscaled slop for 44pt on screen', () => {
    const slop = tapSlop({ width: 100, height: 30 }, 0.05);
    expect((100 + 2 * slop.x) * 0.05).toBeCloseTo(44);
    expect((30 + 2 * slop.y) * 0.05).toBeCloseTo(44);
    expect(tapSlop({ width: 100, height: 30 }, 1)).toEqual({ x: 0, y: 7 });
  });
});

describe('style cycle + tagged people', () => {
  it('cycles classic > outline > solid > neon > classic', () => {
    expect(nextMentionStyle(undefined)).toBe('classic');
    expect(nextMentionStyle('classic')).toBe('outline');
    expect(nextMentionStyle('outline')).toBe('solid');
    expect(nextMentionStyle('solid')).toBe('neon');
    expect(nextMentionStyle('neon')).toBe('classic');
  });
  it('lists every tagged person even when their stickers are invisible', () => {
    const people = taggedPeople([
      { id: '1', type: 'mention', x: 0, y: 0, mentionUserId: 'u1', mentionHandle: '@a', opacity: 0.02, scale: 0.05 },
      { id: '2', type: 'mention', x: 0, y: 0, mentionUserId: 'u1', mentionHandle: '@a' },
      { id: '3', type: 'mention', x: 0, y: 0, mentionUserId: 'u2', mentionHandle: '@b' },
      { id: '4', type: 'text', x: 0, y: 0, text: '@c' },
    ]);
    expect(people.map((p) => p.userId)).toEqual(['u1', 'u2']);
  });
  it('builds the profile route and normalises @', () => {
    expect(withAt('@@bob')).toBe('@bob');
    expect(mentionProfileHref({ userId: 'u 1', name: 'Bob B', handle: 'bob' }))
      .toBe('/buyer-other-profile?userId=u%201&name=Bob%20B&handle=%40bob');
  });
});

describe('inline @ suggestions', () => {
  it('detects only a trailing @token', () => {
    expect(activeMentionQuery('hi @al')).toEqual({ query: 'al', start: 3 });
    expect(activeMentionQuery('@')).toEqual({ query: '', start: 0 });
    expect(activeMentionQuery('hi @al there')).toBeNull();
    expect(activeMentionQuery('mail a@b')).toBeNull();
  });
  it('replaces the partial with the chosen username', () => {
    expect(insertMention('hi @al', 'alice')).toBe('hi @alice ');
    expect(insertMention('plain', 'alice')).toBe('plain @alice ');
  });
});

describe('reshare background', () => {
  it('averages opaque pixels and ignores transparent ones', () => {
    expect(averageRgba([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0])).toBe('#800080');
    expect(averageRgba([1, 2, 3, 0])).toBeNull();
  });
  it('falls back to black/silver when sampling fails', () => {
    expect(reshareBackground(null)).toEqual({ colors: RESHARE_FALLBACK_COLORS, sampled: false });
    expect(reshareBackground('nope').sampled).toBe(false);
    const ok = reshareBackground('#804020');
    expect(ok.sampled).toBe(true);
    expect(ok.colors[0]).toBe('#804020');
  });
});

import { reshareGradientFromBackground } from './storyReshare';
describe('reshare gradient from stored background', () => {
  it('uses black/silver for the fallback marker and a deepened gradient otherwise', () => {
    expect(reshareGradientFromBackground('#0b0b0b')).toEqual(RESHARE_FALLBACK_COLORS);
    expect(reshareGradientFromBackground(undefined)).toEqual(RESHARE_FALLBACK_COLORS);
    expect(reshareGradientFromBackground('#804020')[0]).toBe('#804020');
  });
});

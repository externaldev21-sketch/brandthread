import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', Platform: { OS: 'ios', select: (o: any) => o.default }, StyleSheet: { create: (s: any) => s, hairlineWidth: 0.5 } }));
vi.mock('react-native-reanimated', () => ({ default: { View: 'View' }, useSharedValue: (v: any) => ({ value: v }), useAnimatedStyle: () => ({}), withSpring: (v: any) => v, withTiming: (v: any) => v, withSequence: (...a: any[]) => a, withDelay: (_: any, v: any) => v, runOnJS: (f: any) => f, Easing: { out: () => 0, cubic: 0 } }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: 'Image' }));
vi.mock('@/lib/theme', () => ({ ON_DARK: '#fff', ON_DARK_MUTED: '#ccc' }));
vi.mock('@/constants/typography', () => ({ TABULAR_NUMS: {} }));
vi.mock('@/constants/radii', () => ({ RADII: { pill: 999 } }));
vi.mock('@/components/live/LiveAvatarRing', () => ({ LiveHostRing: 'LiveHostRing' }));
vi.mock('@/lib/live/useLiveDirectory', () => ({ useLiveStreamForHost: () => null }));
vi.mock('@/components/buyer-feed/RailGlyph', () => ({ RailGlyph: 'RailGlyph' }));
vi.mock('../components/buyer-feed/RailGlyph', () => ({ RailGlyph: 'RailGlyph' }));

const src = readFileSync(resolve(__dirname, '../components/buyer-feed/RightActionRail.tsx'), 'utf8');

describe('formatRailCount', async () => {
  const m = await import('../components/buyer-feed/RightActionRail');
  it('shows real zero and safe 0 for invalid/negative', () => {
    for (const v of [0, -5, NaN, Infinity, -Infinity, 0.4, undefined as any]) expect(m.formatRailCount(v)).toBe('0');
  });
  it('exact 0-999 then compact K/M, and updates from 0', () => {
    expect([1, 7, 999].map(m.formatRailCount)).toEqual(['1', '7', '999']);
    expect([1000, 1200, 12_345, 999_999, 1_000_000, 3_400_000, 12_000_000].map(m.formatRailCount))
      .toEqual(['1K', '1.2K', '12.3K', '999.9K', '1M', '3.4M', '12M']);
  });
  it('spacing metrics', () => {
    expect(m.RAIL_ICON_SIZE).toBe(32);
    expect(m.RAIL_ITEM_GAP).toBe(12);
    expect(m.RAIL_COUNT_GAP).toBe(1);
    expect(m.RAIL_AVATAR_TO_LIKE).toBe(16);
  });
  it('renders all five zero counts and reflects immediate updates and rollback', async () => {
    const onLike = vi.fn();
    const props: React.ComponentProps<typeof m.RightActionRail> = {
      creator: 'Brandthread', avatarColor: '#000', initials: 'B', shareBottom: 140,
      footerSlot: React.createElement('SoundDisc'),
      engagement: { likes: 0, reposts: 0, saves: 0 },
      commentsCount: 0, shares: 0, saves: 0, testIdBase: 'real-post',
      onOpenCreator: vi.fn(), onFollow: vi.fn(), onLike,
      onOpenComments: vi.fn(), onRepost: vi.fn(), onSave: vi.fn(), onShare: vi.fn(),
    };
    let tree!: ReactTestRenderer;
    const counts = () => ['like', 'comment', 'repost', 'save', 'share'].map(
      name => tree.root.findByProps({ testID: `${name}-btn-real-post` })
        .findByType('Text' as any).props.children,
    );
    try {
      await act(async () => { tree = create(React.createElement(m.RightActionRail, props)); });
      expect(counts()).toEqual(['0', '0', '0', '0', '0']);
      const action = tree.root.findByProps({ testID: 'like-btn-real-post' }).findByType('Pressable' as any);
      expect(action.props.hitSlop).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
      expect(action.props.style({ pressed: false })[0]).toMatchObject({ minHeight: 0, gap: 1 });
      expect(action.findByType('Text' as any).props.style).toMatchObject({ fontSize: 12, lineHeight: 14 });
      const railRoot = tree.root.findAllByType('View' as any).find(node => node.props.pointerEvents === 'box-none')!;
      expect(railRoot.props.style[2].bottom).toBe(140 - 44 - 12);
      const footer = railRoot.findAllByType('View' as any).find(node => typeof node.props.onLayout === 'function')!;
      await act(async () => { footer.props.onLayout({ nativeEvent: { layout: { height: 56 } } }); });
      expect(railRoot.props.style[2].bottom).toBe(140 - 56 - 12);
      await act(async () => { tree.root.findByProps({ testID: 'like-btn-real-post' }).props.onPress(); });
      expect(onLike).toHaveBeenCalledOnce();
      await act(async () => {
        tree.update(React.createElement(m.RightActionRail, {
          ...props, engagement: { liked: true, likes: 1, reposted: true, reposts: 1, saved: true, saves: 1 },
          commentsCount: 1, shares: 1,
        }));
      });
      expect(counts()).toEqual(['1', '1', '1', '1', '1']);
      await act(async () => { tree.update(React.createElement(m.RightActionRail, props)); });
      expect(counts()).toEqual(['0', '0', '0', '0', '0']);
    } finally {
      if (tree) await act(async () => { tree.unmount(); });
    }
  });
});

describe('rail source geometry', () => {
  it('order avatar, like, comment, repost, save, share', () => {
    const idx = ['avatar-btn-', 'glyph="heart"', 'glyph="comment"', 'glyph="repost"', 'glyph="bookmark"', 'glyph="share"'].map((k) => src.indexOf(k));
    expect(idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]))).toBe(true);
  });
  it('avatar wrap pinned; badge and Official absolute in interstitial', () => {
    expect(src).toContain("height: AVATAR, marginBottom: RAIL_AVATAR_TO_LIKE - RAIL_ITEM_GAP");
    expect(src).toMatch(/official: \{\s*position: 'absolute', top: AVATAR \+ BADGE \/ 2,/);
    expect(src).toContain("<Text style={styles.count} numberOfLines={1}>{text}</Text>");
    expect(src).not.toContain('bottom: \'50%\'');
  });
});

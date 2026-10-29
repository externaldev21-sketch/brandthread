import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  Platform: { select: (options: Record<string, unknown>) => options.default },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: 'View' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values.at(-1),
  withDelay: (_delay: number, value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
  Easing: { out: (fn: unknown) => fn, cubic: (value: number) => value },
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: 'Image' }));
vi.mock('@/lib/theme', () => ({ ON_DARK: '#fff', ON_DARK_MUTED: '#ccc', FONT: { semibold: 'system-600', bold: 'system-700' }, FS: { xs: 11 } }));
vi.mock('@/constants/typography', () => ({ TABULAR_NUMS: {} }));
vi.mock('@/components/live/LiveAvatarRing', () => ({ LiveHostRing: 'LiveHostRing' }));
vi.mock('@/lib/live/useLiveDirectory', () => ({ useLiveStreamForHost: () => null }));
vi.mock('../components/buyer-feed/RailGlyph', () => ({ RailGlyph: 'RailGlyph' }));

import { RAIL_LAYOUT, RightActionRail } from '../components/buyer-feed/RightActionRail';

describe('feed rail avatar regression', () => {
  it.each([
    { avatarSource: 1 },
    { avatarUri: 'https://example.invalid/avatar.jpg' },
    {},
  ])('retains the original circle and centered overlapping follow badge: %j', async (image) => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<RightActionRail
        creator="Creator" initials="C" avatarColor="#222" {...image}
        engagement={{ following: false }} commentsCount={0} shares={0} saves={0}
        testIdBase="avatar-check" onOpenCreator={() => {}} onFollow={() => {}}
        onLike={() => {}} onOpenComments={() => {}} onSave={() => {}} onShare={() => {}}
      />);
    });
    try {
      const button = tree.root.findByProps({ testID: 'avatar-btn-avatar-check' });
      const hitStyle = button.props.style({ pressed: false })[0];
      expect(hitStyle).toMatchObject({ width: 38, height: 38, alignItems: 'center' });
      const circle = button.findAll(node => {
        const styles = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
        return styles.some(style => style?.borderRadius === 19);
      })[0];
      expect(circle).toBeDefined();
      const circleStyles = Array.isArray(circle.props.style) ? circle.props.style : [circle.props.style];
      expect(circleStyles[0]).toMatchObject({ width: 38, height: 38, borderRadius: 19, overflow: 'hidden' });
      const follow = tree.root.findByProps({ testID: 'follow-btn-avatar-check' });
      const badgeStyle = follow.parent!.props.style[0];
      expect(badgeStyle).toMatchObject({ left: 14, top: 28, width: 20, height: 20 });
      expect(badgeStyle.top + badgeStyle.height / 2).toBe(38);
      // Shrinking the avatar must not move Like or any of the other groups.
      const wrapStyle = button.parent!.props.style;
      expect(wrapStyle).toMatchObject({ width: RAIL_LAYOUT.width, alignSelf: 'center', alignItems: 'center' });
      expect(badgeStyle.left + badgeStyle.width / 2).toBe(RAIL_LAYOUT.width / 2);
      expect(wrapStyle.height + wrapStyle.marginBottom + 12).toBe(73);
      expect(RAIL_LAYOUT).toMatchObject({ width: 48, avatarBlock: 73, item: 65, icon: 32, disc: 40 });
    } finally {
      await act(async () => tree.unmount());
    }
  });
});

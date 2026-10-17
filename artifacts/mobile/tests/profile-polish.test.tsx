import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Profile polish pass (390x844 audit): a grid tile never shows "▶ 0", and
// the compact sticky profile bar only takes touches while it is shown.

vi.mock('react-native', () => {
  const ReactActual = require('react') as typeof import('react');
  const host = (name: string) => (props: any) => ReactActual.createElement(name, props, props.children);
  class AnimatedValue {
    constructor(public value: number) {}
    interpolate() { return this; }
  }
  return {
    View: host('View'),
    Text: host('Text'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
    Animated: {
      View: host('AnimatedView'),
      Value: AnimatedValue,
      timing: () => ({ start: () => {} }),
    },
  };
});
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('@expo/vector-icons', () => ({ Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }) }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: ({ children, ...props }: any) => React.createElement('Pressable', props, typeof children === 'function' ? children({ pressed: false }) : children),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => React.createElement('Image') }));
vi.mock('@/components/layout', () => ({ SkeletonBlock: () => null }));
vi.mock('@/services/profileService', () => ({ posterForPost: () => null }));
vi.mock('@/components/profile/ProfileControls', () => ({ InteractionLayer: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { background: '#000', text: '#fff', muted: '#aaa', subtle: '#777', border: '#333', cardElevated: '#111', cardGlass: '#111', warning: '#fa0' },
  }),
}));

import { ProfileVideoTile, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileStickyHeader } from '@/components/profile/ProfileStickyHeader';
import { formatCompactCount } from '@/lib/compactFormat';

function render(node: React.ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(node); });
  return renderer;
}

const tile = (viewsCount: number): ProfileGridItem => ({
  id: `v-${viewsCount}`, kind: 'video', posterUri: 'https://example.test/p.jpg', caption: '', viewsCount, productCount: 0,
});

describe('profile grid tile view count', () => {
  it('hides the play count at 0 and shows it once there are views', () => {
    const zero = render(<ProfileVideoTile item={tile(0)} index={0} width={130} height={173} onPress={() => {}} />);
    expect(zero.root.findAll((node) => (node.type as unknown) === 'Feather' && node.props.name === 'play')).toHaveLength(0);

    const some = render(<ProfileVideoTile item={tile(1200)} index={0} width={130} height={173} onPress={() => {}} />);
    expect(some.root.findAll((node) => (node.type as unknown) === 'Feather' && node.props.name === 'play')).toHaveLength(1);
    expect(some.root.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === formatCompactCount(1200))).toHaveLength(1);
  });
});

describe('profile sticky header', () => {
  it('ignores touches while hidden and shows the handle once visible', () => {
    const hidden = render(<ProfileStickyHeader visible={false} topPad={47} title="@ava" />);
    expect(hidden.root.findByProps({ testID: 'profile-sticky-header' }).props.pointerEvents).toBe('none');

    const shown = render(<ProfileStickyHeader visible topPad={47} title="@ava" />);
    const bar = shown.root.findByProps({ testID: 'profile-sticky-header' });
    expect(bar.props.pointerEvents).toBe('box-none');
    expect(shown.root.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === '@ava')).toHaveLength(1);
  });
});

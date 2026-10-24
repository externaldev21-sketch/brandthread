import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The shared PersonRow (search People tab, Activity people lists): tapping
// "Following" confirms before unfollowing — the same sheet as the Following
// list — and a pending request to a private account reads "Requested".

vi.mock('react-native', () => {
  const React = require('react') as any;
  const nativeComponent = (name: string) => function Mock(props: Record<string, unknown>) {
    return React.createElement(name, props, props.children as React.ReactNode);
  };
  class AnimatedValue { constructor(public v: number) {} }
  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    Pressable: nativeComponent('Pressable'),
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    Animated: { Value: AnimatedValue, View: nativeComponent('AnimatedView') },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  };
});
vi.mock('@/constants/motion', () => ({ PRESS_SCALE: 0.97, pressScaleAnim: () => ({ start: () => {} }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/VerifiedBadge', () => ({ VerifiedBadge: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/lib/haptics', () => ({ haptics: {}, hapticFollow: vi.fn() }));
vi.mock('@/lib/theme', () => ({ FONT: { semibold: 'semi', bold: 'bold', regular: 'reg', medium: 'med' } }));
vi.mock('@/components/ui/ActionSheet', () => ({ showActionSheet: vi.fn() }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#FAFAFA', muted: '#D7D7DB', onAccent: '#0A0A0B' } }),
}));

import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { showActionSheet } from '@/components/ui/ActionSheet';

const base: SearchPerson = {
  userId: 'u1', name: 'Ava Buyer', username: 'ava', handle: '@ava', initials: 'AB', color: '#333', bio: null, isFollowing: false,
};

function pill(renderer: ReactTestRenderer) {
  return renderer.root.findAll((n) => n.props.testID === 'search-follow-u1' && typeof n.props.onPress === 'function')[0];
}
function label(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType('Text' as any).map((n) => n.props.children).filter((c) => typeof c === 'string').join('|');
}

describe('PersonRow follow pill', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => { vi.mocked(showActionSheet).mockReset(); });
  afterEach(() => { act(() => { renderer?.unmount(); }); renderer = undefined; });

  it('follows straight away', () => {
    const onToggleFollow = vi.fn();
    act(() => { renderer = create(<PersonRow person={base} loading={false} onPress={() => {}} onToggleFollow={onToggleFollow} />); });
    act(() => { pill(renderer!).props.onPress(); });
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
    expect(showActionSheet).not.toHaveBeenCalled();
  });

  it('confirms before unfollowing', () => {
    const onToggleFollow = vi.fn();
    act(() => { renderer = create(<PersonRow person={{ ...base, isFollowing: true }} loading={false} onPress={() => {}} onToggleFollow={onToggleFollow} />); });
    act(() => { pill(renderer!).props.onPress(); });
    expect(onToggleFollow).not.toHaveBeenCalled();
    const [title, , buttons] = vi.mocked(showActionSheet).mock.calls[0];
    expect(title).toBe('Unfollow Ava Buyer?');
    expect(buttons.map((b) => [b.text, b.style])).toEqual([['Unfollow', 'destructive'], ['Cancel', 'cancel']]);
    act(() => { buttons[0].onPress?.(); });
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it('shows "Requested" for a pending request, and tapping it cancels without a confirm', () => {
    const onToggleFollow = vi.fn();
    act(() => { renderer = create(<PersonRow person={{ ...base, requested: true }} loading={false} onPress={() => {}} onToggleFollow={onToggleFollow} />); });
    expect(label(renderer!)).toContain('Requested');
    expect(pill(renderer!).props.accessibilityLabel).toMatch(/^Requested/);
    act(() => { pill(renderer!).props.onPress(); });
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
    expect(showActionSheet).not.toHaveBeenCalled();
  });
});

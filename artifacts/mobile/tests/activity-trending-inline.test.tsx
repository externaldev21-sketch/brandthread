import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, followMock, unfollowMock, routerMock } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      const { children, style, ...rest } = props;
      const resolved = typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style;
      return React.createElement(name, { ...rest, style: resolved }, children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  followMock: vi.fn(),
  unfollowMock: vi.fn(),
  routerMock: { push: vi.fn(), back: vi.fn() },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Pressable: nativeComponent('Pressable'),
  Text: nativeComponent('Text'),
  View: nativeComponent('View'),
  StyleSheet: { create: <T,>(s: T) => s, hairlineWidth: 0.5 },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('expo-router', () => ({ useRouter: () => routerMock }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: nativeComponent('CachedImage') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: {
    text: '#FFFFFF', muted: '#C0C0C0', border: '#333333', card: '#111111', accent: '#FFFFFF',
    onAccent: '#000000', accentDim: '#222222', accentLight: '#FFFFFF', background: '#000000',
  } }),
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ social: { follow: followMock, unfollow: unfollowMock } }) }));

import { ActivityTrendingBrands } from '../components/activity/ActivityTrendingBrands';

const BRANDS = [
  { id: 'seller_a', name: 'Northline Studio', verified: true, imageUri: 'https://img.test/a.jpg', followersLabel: '12.4K followers' },
  { id: 'seller_b', name: 'Vale Atelier', verified: false, followersLabel: '864 followers' },
];

let renderer: ReactTestRenderer | null = null;
const textOf = (r: ReactTestRenderer) => r.root.findAllByType('Text' as never)
  .map((n) => React.Children.toArray(n.props.children).join('')).join(' | ');

beforeEach(() => {
  followMock.mockReset();
  unfollowMock.mockReset();
  routerMock.push.mockReset();
});
afterEach(() => { act(() => renderer?.unmount()); renderer = null; });

describe('ActivityTrendingBrands', () => {
  it('renders nothing when there are no trending brands', () => {
    act(() => { renderer = create(<ActivityTrendingBrands brands={[]} />); });
    expect(renderer!.toJSON()).toBeNull();
  });

  it('shows the "Trending brands" header, See all, and one row per brand with name + meta', () => {
    act(() => { renderer = create(<ActivityTrendingBrands brands={BRANDS} />); });
    const text = textOf(renderer!);
    expect(text).toContain('Trending brands');
    expect(text).toContain('See all');
    expect(text).toContain('Northline Studio');
    expect(text).toContain('12.4K followers');
    expect(text).not.toContain('Find people to follow');
    expect(renderer!.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('activity-trending-row-') && (n.type as unknown) === 'View')).toHaveLength(2);
    // Verified badge only on the verified brand.
    expect(renderer!.root.findAllByType('Feather' as never).filter((n) => n.props.name === 'check-circle')).toHaveLength(1);
  });

  it('See all opens the existing Trending brands screen', () => {
    act(() => { renderer = create(<ActivityTrendingBrands brands={BRANDS} />); });
    act(() => { renderer!.root.findByProps({ testID: 'activity-trending-see-all' }).props.onPress(); });
    expect(routerMock.push).toHaveBeenCalledWith('/buyer-trending?type=brands');
  });

  it('Follow flips to Following right away and calls the real follow API', async () => {
    let resolve!: (v: unknown) => void;
    followMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    act(() => { renderer = create(<ActivityTrendingBrands brands={BRANDS} />); });
    const button = () => renderer!.root.findAllByProps({ testID: 'follow-button' })[0];
    expect(button().props.accessibilityLabel).toBe('Follow');
    await act(async () => { button().props.onPress(); });
    expect(followMock).toHaveBeenCalledWith('seller_a');
    expect(button().props.accessibilityLabel).toBe('Following');
    await act(async () => { resolve({ ok: true, isFollowing: true, followersCount: 1 }); });
    expect(button().props.accessibilityLabel).toBe('Following');
  });

  it('rolls the button back if the follow call fails', async () => {
    followMock.mockRejectedValue(new Error('offline'));
    act(() => { renderer = create(<ActivityTrendingBrands brands={BRANDS} />); });
    const button = () => renderer!.root.findAllByProps({ testID: 'follow-button' })[0];
    await act(async () => { button().props.onPress(); });
    expect(button().props.accessibilityLabel).toBe('Follow');
  });
});

describe('Activity screen wiring', () => {
  const src = readFileSync(path.join(__dirname, '../app/activity-center.tsx'), 'utf8');

  it('renders Trending brands in the list FOOTER, so activity rows always come first', () => {
    const footerStart = src.indexOf('const listFooter = (');
    const footerEnd = src.indexOf('\n  );', footerStart);
    expect(src.slice(footerStart, footerEnd)).toContain('<ActivityTrendingBrands');
    expect(src).toContain('ListFooterComponent={listFooter}');
    // Not in the header, and only rendered once.
    expect(src.match(/<ActivityTrendingBrands/g)).toHaveLength(1);
    const header = src.slice(src.indexOf('ListHeaderComponent='), src.indexOf('ListEmptyComponent='));
    expect(header).not.toContain('Trending');
  });

  it('hides the back arrow only for the buyer tab (audit #52)', () => {
    expect(src).toContain('showBack={!isTab}');
    const tab = readFileSync(path.join(__dirname, '../app/(buyer)/activity.tsx'), 'utf8');
    expect(tab).toContain('<ActivityCenterScreen isTab />');
  });
});

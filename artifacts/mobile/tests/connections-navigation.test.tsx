import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Follower / following lists: every row opens that person's profile on the
// right screen for their account type, and another profile's list is loaded
// by its userId (not the viewer's own list).

const { routerMock, apiMock, paramsMock, clerkMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), back: vi.fn() },
  apiMock: { social: { followers: vi.fn(), following: vi.fn() } },
  paramsMock: vi.fn(() => ({ type: 'followers', userId: 'user_seller' } as Record<string, string | undefined>)),
  clerkMock: vi.fn(() => ({ user: { id: 'viewer-1' }, isLoaded: true } as { user: { id: string } | undefined; isLoaded: boolean })),
}));

vi.mock('react-native', () => {
  const React = require('react') as any;
  const nativeComponent = (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    return MockNativeComponent;
  };
  return {
    View: nativeComponent('View'),
    Text: nativeComponent('Text'),
    ScrollView: nativeComponent('ScrollView'),
    FlatList: ({ data, renderItem, keyExtractor }: any) =>
      React.createElement('FlatList', null, data.map((item: any, index: number) =>
        React.createElement(React.Fragment, { key: keyExtractor(item, index) }, renderItem({ item, index })))),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
    Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  };
});

vi.mock('expo-router', () => ({
  useRouter: () => routerMock,
  useLocalSearchParams: () => paramsMock(),
  useFocusEffect: (callback: () => void) => {
    const ReactActual = require('react') as typeof import('react');
    ReactActual.useEffect(callback, [callback]);
  },
}));

vi.mock('@clerk/expo', () => ({ useUser: () => clerkMock() }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => apiMock }));
vi.mock('@expo/vector-icons', () => ({ Feather: ({ name }: { name: string }) => React.createElement('Feather', { name }) }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/components/layout', () => ({
  Header: ({ title }: { title: string }) => React.createElement('Text', null, title),
  ListSkeleton: () => React.createElement('View', { testID: 'list-skeleton' }),
}));
vi.mock('@/components/CachedImage', () => ({ CachedImage: (props: any) => React.createElement('CachedImage', props) }));
vi.mock('@/components/ui/ErrorState', () => ({
  ErrorState: ({ message, onRetry }: any) => React.createElement('Pressable', { testID: 'error-retry', onPress: onRetry }, message),
}));
vi.mock('@/components/BrandthreadUI', () => {
  const ReactActual = require('react') as typeof import('react');
  return {
    PressableScale: ({ children, ...rest }: any) => ReactActual.createElement(
      'Pressable', rest, typeof children === 'function' ? children({ pressed: false }) : children,
    ),
    EmptyState: ({ title }: { title: string }) => ReactActual.createElement('Text', null, title),
    SearchBar: (props: any) => React.createElement('TextInput', props),
  };
});
vi.mock('@/components/ui/ActionSheet', () => ({ showActionSheet: vi.fn() }));
vi.mock('@/components/ui/OptionSheet', () => ({
  OptionSheet: () => React.createElement('View', { testID: 'sort-sheet' }),
}));
vi.mock('@/components/social/RemoveFollowerSheet', () => ({
  RemoveFollowerSheet: () => React.createElement('View', { testID: 'remove-follower-sheet' }),
}));
vi.mock('@/components/social/CenteredToast', () => ({
  CenteredToast: () => null,
}));
vi.mock('@/services/socialService', () => ({
  setSellerFollowing: vi.fn().mockResolvedValue(undefined),
  removeFollower: vi.fn().mockResolvedValue({ followersCount: 0 }),
}));
vi.mock('@/lib/haptics', () => ({ hapticDestructiveConfirm: vi.fn() }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      background: '#09090B', text: '#FAFAFA', muted: '#D7D7DB', border: '#FFFFFF22', card: '#18181B',
      cardElevated: '#18181B', cardGlass: '#18181BE8', accent: '#C7CDD5', accentDim: '#C7CDD52E',
      onAccent: '#0A0A0B', warning: '#FFD580', shadowColor: '#000',
    },
  }),
}));

import ConnectionsScreen from '@/app/connections';

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ConnectionsScreen />); await flush(); });
  return renderer;
}

function row(renderer: ReactTestRenderer, id: string) {
  return renderer.root.findAll((node) => node.props.testID === `connection-row-${id}` && typeof node.props.onPress === 'function')[0];
}

describe('connections list', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    routerMock.push.mockReset();
    clerkMock.mockReset().mockReturnValue({ user: { id: 'viewer-1' }, isLoaded: true });
    paramsMock.mockReset().mockReturnValue({ type: 'followers', userId: 'user_seller' });
    apiMock.social.followers.mockReset().mockResolvedValue([
      { userId: 'user_buyer', name: 'Ava Buyer', username: 'ava', handle: '@ava', initials: 'AB', accountType: 'buyer', isFollowing: true },
      { userId: 'user_brand', name: 'Brand Co', username: 'brandco', handle: '@brandco', initials: 'BC', accountType: 'seller', isFollowing: false },
    ]);
    apiMock.social.following.mockReset().mockResolvedValue([]);
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = undefined;
  });

  it("loads the viewed profile's followers, not the viewer's", async () => {
    renderer = await renderScreen();
    expect(apiMock.social.followers).toHaveBeenCalledWith('user_seller');
    expect(apiMock.social.following).toHaveBeenCalledWith('user_seller', 'default');
  });

  it('opens a buyer row on the buyer profile (with the userId param) and a seller row on the brand profile', async () => {
    renderer = await renderScreen();
    await act(async () => { row(renderer!, 'user_buyer').props.onPress(); });
    expect(routerMock.push).toHaveBeenLastCalledWith('/buyer-other-profile?userId=user_buyer&name=Ava%20Buyer&handle=%40ava&initials=AB');
    await act(async () => { row(renderer!, 'user_brand').props.onPress(); });
    expect(routerMock.push).toHaveBeenLastCalledWith('/seller-profile?id=user_brand');
  });

  it("loads the viewer's own list when no userId is given", async () => {
    paramsMock.mockReturnValue({ type: 'following', userId: undefined });
    renderer = await renderScreen();
    expect(apiMock.social.following).toHaveBeenCalledWith(undefined, 'default');
    expect(apiMock.social.followers).toHaveBeenCalledWith(undefined);
  });

  it('loads as soon as Clerk resolves after mount, with no focus transition required', async () => {
    // Regression test: useFocusEffect only re-runs on a focus transition, so
    // a screen that mounted before Clerk resolved used to be stuck on its
    // skeleton forever once Clerk became ready while the screen stayed
    // focused (no re-navigation to trigger another useFocusEffect run).
    clerkMock.mockReturnValue({ user: { id: 'viewer-1' }, isLoaded: false });
    renderer = await renderScreen();
    expect(apiMock.social.followers).not.toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.props.testID === 'list-skeleton').length).toBe(1);

    clerkMock.mockReturnValue({ user: { id: 'viewer-1' }, isLoaded: true });
    await act(async () => { renderer!.update(<ConnectionsScreen />); await flush(); });
    expect(apiMock.social.followers).toHaveBeenCalledWith('user_seller');
    expect(renderer.root.findAll((node) => node.props.testID === 'list-skeleton').length).toBe(0);
  });

  it("does not hang on the loading skeleton forever when Clerk has resolved but there is no real user object (e.g. the dev web preview)", async () => {
    // Regression test: the own-list guard used to be
    // `if (!clerkLoaded || !user?.id) return;`, which left `loading` stuck
    // true forever whenever Clerk finished loading without a real signed-in
    // user object — exactly what happens in the dev web preview, which
    // never creates a real Clerk session. `!userId` already establishes
    // "own list" with no user object required.
    clerkMock.mockReturnValue({ user: undefined, isLoaded: true });
    paramsMock.mockReturnValue({ type: 'followers', userId: undefined });
    renderer = await renderScreen();
    expect(apiMock.social.followers).toHaveBeenCalledWith(undefined);
    expect(renderer.root.findAll((node) => node.props.testID === 'list-skeleton').length).toBe(0);
  });

  it('shows ErrorState with Retry instead of an endless spinner when the list fails', async () => {
    apiMock.social.followers.mockRejectedValueOnce(new Error('offline'));
    renderer = await renderScreen();
    const retry = renderer.root.findByProps({ testID: 'error-retry' });
    await act(async () => { retry.props.onPress(); await flush(); });
    expect(apiMock.social.followers).toHaveBeenCalledTimes(2);
    expect(row(renderer, 'user_buyer')).toBeTruthy();
  });
});

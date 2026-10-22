import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ signedIn: false, preview: false }));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: state.signedIn }) }));
vi.mock('expo-router', () => ({
  usePathname: () => '/inbox',
  useGlobalSearchParams: () => ({}),
}));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { background: '#000' } }) }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 48 }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => state.preview,
  isSellerDevPreview: () => false,
}));
vi.mock('@/lib/devBypass', () => ({ DEV_BYPASS_ROLE: null }));
vi.mock('@/components/reframe', () => ({
  ScreenHeader: ({ title }: { title: string }) => React.createElement('header', null, title),
  EmptyState: ({ onAction, testID, message }: { onAction: () => void; testID: string; message: string }) =>
    React.createElement('button', { onPress: onAction, testID: `${testID}-action` }, message),
}));
import { GuestRouteBoundary } from '../components/GuestRouteBoundary';
import { closeGuestSignIn, getGuestSignInRequest } from '../lib/guestSignIn';
import { isGuestScreenEntry } from '../lib/guestRoutes';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  closeGuestSignIn(false);
  state.signedIn = false;
  state.preview = false;
});

describe('navigation never requests sign-in', () => {
  it('shows inline states on every private tab and deep link without mounting private content or prompting', async () => {
    const privateContentMounted = vi.fn();
    function PrivateScreen() { privateContentMounted(); return null; }
    for (const [routeName, buyerTab] of [
      ['inbox', true], ['activity', true], ['profile', true], ['cart', true], ['orders', true],
      ['(tabs)', false], ['buyer-conversation', false], ['buyer-checkout', false],
      ['orders', false], ['settings', false], ['create-post', false],
    ] as const) {
      await act(async () => {
        const screen = <GuestRouteBoundary routeName={routeName} buyerTab={buyerTab}><PrivateScreen /></GuestRouteBoundary>;
        if (renderer) renderer.update(screen);
        else renderer = create(screen);
      });
      expect(getGuestSignInRequest(), routeName).toBeNull();
      expect(renderer!.root.findByProps({ testID: 'guest-inline-sign-in-action' })).toBeTruthy();
    }
    expect(privateContentMounted).not.toHaveBeenCalled();
  });

  it('only requests the sheet from the inline button, dismisses without navigation and does not reopen on rerender', async () => {
    const screen = <GuestRouteBoundary routeName="inbox" buyerTab><span>Private messages</span></GuestRouteBoundary>;
    await act(async () => { renderer = create(screen); });
    expect(getGuestSignInRequest()).toBeNull();
    renderer!.root.findByProps({ testID: 'guest-inline-sign-in-action' }).props.onPress();
    expect(getGuestSignInRequest()?.returnTo).toBe('/inbox');
    closeGuestSignIn();
    await act(async () => {
      renderer!.update(<GuestRouteBoundary routeName="profile" buyerTab><span>Private profile</span></GuestRouteBoundary>);
    });
    expect(getGuestSignInRequest()).toBeNull();
  });

  it('preserves public browsing, auth, legal and invite routes', () => {
    for (const route of ['index', '(buyer)', 'sign-in', 'onboarding', 'privacy', 'team-invite', 'community-join', 'seller-profile', 'buyer-other-profile', 'buyer-post-comments', 'buyer-product-detail', 'live']) {
      expect(isGuestScreenEntry(route), route).toBe(true);
    }
    for (const route of ['index', 'discover', 'search', 'feed']) expect(isGuestScreenEntry(route, true)).toBe(true);
  });

  it.each(['signedIn', 'preview'] as const)('preserves %s access without changing private screens', async key => {
    state[key] = true;
    await act(async () => {
      renderer = create(<GuestRouteBoundary routeName="inbox" buyerTab><span>Private messages</span></GuestRouteBoundary>);
    });
    expect(renderer!.root.findByType('span').props.children).toBe('Private messages');
    expect(getGuestSignInRequest()).toBeNull();
  });

  it('root auth navigation cannot request the action sheet', () => {
    const root = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
    expect(root).not.toContain('requestGuestSignIn');
    expect(root).toContain('<GuestRouteBoundary routeName={route.name}>');
  });
});

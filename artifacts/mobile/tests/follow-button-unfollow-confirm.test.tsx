import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The shared FollowButton: following is one tap, unfollowing confirms first
// (the Following list's "Unfollow {name}?" sheet), for every screen using it.

const { followMock, unfollowMock } = vi.hoisted(() => ({ followMock: vi.fn(), unfollowMock: vi.fn() }));

vi.mock('react-native', () => {
  const React = require('react') as any;
  const nativeComponent = (name: string) => function Mock(props: Record<string, unknown>) {
    const children = typeof props.children === 'function' ? (props.children as any)({ pressed: false }) : props.children;
    return React.createElement(name, { ...props, style: undefined }, children as React.ReactNode);
  };
  return {
    Pressable: nativeComponent('Pressable'),
    Text: nativeComponent('Text'),
    View: nativeComponent('View'),
    ActivityIndicator: nativeComponent('ActivityIndicator'),
    StyleSheet: { create: (styles: unknown) => styles },
    Platform: { OS: 'ios' },
  };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/lib/haptics', () => ({ hapticFollow: vi.fn() }));
vi.mock('@/lib/theme', () => ({ FILL_ELEVATED: '#222', FONT: { semibold: 'semi' }, FS: { meta: 13, sm: 14 }, RADIUS: { pill: 999 }, SP: { sm: 8, md: 16 }, TEXT_DISABLED: '#666' }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { accent: '#fff', onAccent: '#000', text: '#fff', card: '#111', border: '#333' } }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ social: { follow: followMock, unfollow: unfollowMock } }) }));
vi.mock('@/lib/previewFollowStore', () => ({ canUsePreviewFollow: () => false, getPreviewFollowing: () => undefined, setPreviewFollowing: vi.fn() }));
vi.mock('@/lib/safety', () => ({ apiErrorMessage: (_e: unknown, fallback: string) => fallback }));
vi.mock('@/lib/engagementRetryQueue', () => ({ enqueueEngagementRetry: vi.fn(), ensureEngagementRetryPump: vi.fn(), isRetryableFailure: () => false }));
vi.mock('@/lib/actionSheet', () => ({ showAlert: vi.fn() }));
vi.mock('@/components/ui/ActionSheet', () => ({ showActionSheet: vi.fn() }));

import FollowButton from '@/components/social/FollowButton';
import { showActionSheet } from '@/components/ui/ActionSheet';

async function flush() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

describe('FollowButton', () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => {
    followMock.mockReset().mockResolvedValue({ ok: true });
    unfollowMock.mockReset().mockResolvedValue({ ok: true });
    vi.mocked(showActionSheet).mockReset();
  });
  afterEach(() => { act(() => { renderer?.unmount(); }); renderer = undefined; });

  const button = () => renderer!.root.findByProps({ testID: 'follow-button' });

  it('follows on one tap', async () => {
    act(() => { renderer = create(<FollowButton userId="user_a" name="Ava" initial={{ isFollowing: false, isFollowedBy: false, isMutual: false }} />); });
    await act(async () => { button().props.onPress(); await flush(); });
    expect(followMock).toHaveBeenCalledWith('user_a');
    expect(showActionSheet).not.toHaveBeenCalled();
  });

  it('confirms before unfollowing, and only unfollows on "Unfollow"', async () => {
    act(() => { renderer = create(<FollowButton userId="user_a" name="Ava" initial={{ isFollowing: true, isFollowedBy: false, isMutual: false }} />); });
    await act(async () => { button().props.onPress(); await flush(); });
    expect(unfollowMock).not.toHaveBeenCalled();
    const [title, , buttons] = vi.mocked(showActionSheet).mock.calls[0];
    expect(title).toBe('Unfollow Ava?');
    expect(buttons.map((b) => [b.text, b.style])).toEqual([['Unfollow', 'destructive'], ['Cancel', 'cancel']]);
    await act(async () => { buttons[0].onPress?.(); await flush(); });
    expect(unfollowMock).toHaveBeenCalledWith('user_a');
  });
});

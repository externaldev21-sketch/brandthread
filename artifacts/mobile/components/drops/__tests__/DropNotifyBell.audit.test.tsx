/**
 * The bell's module-level status cache used to be keyed by drop id only, so
 * after buyer A (subscribed) signed out and buyer B signed in on the same
 * device, B's bell showed "on" from A's subscription and B's real status was
 * never fetched (the cache hit skipped the request).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = { isSignedIn: true as boolean, userId: 'user_a' as string | null };
const notificationStatus = vi.fn();
const api = { publicDrops: { notificationStatus, subscribe: vi.fn(), unsubscribe: vi.fn() } };

vi.mock('@clerk/expo', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ isSignedIn: auth.isSignedIn, goToSignIn: vi.fn() }) }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', background: '#000', border: '#333' } }) }));
vi.mock('@/components/BrandthreadUI', () => {
  const React = require('react');
  return {
    PressableScale: (props: Record<string, unknown>) => React.createElement('PressableScale', props),
    useUndoToast: () => ({ showUndo: vi.fn() }),
  };
});
vi.mock('@/lib/haptics', () => ({ hapticSelection: vi.fn() }));

import { DropNotifyBell } from '../DropNotifyBell';

const bellOn = (r: ReactTestRenderer) => r.root.findByProps({ testID: 'drop-bell-drop_1' }).props.accessibilityState.selected;

describe('DropNotifyBell account scoping', () => {
  it('does not show one buyer\'s alert to the next account on this device', async () => {
    notificationStatus.mockResolvedValueOnce({ subscribed: true });
    let a!: ReactTestRenderer;
    await act(async () => { a = create(<DropNotifyBell dropId="drop_1" dropName="Drop" />); });
    expect(bellOn(a)).toBe(true);
    act(() => { a.unmount(); });

    auth.userId = 'user_b';
    notificationStatus.mockResolvedValueOnce({ subscribed: false });
    let b!: ReactTestRenderer;
    await act(async () => { b = create(<DropNotifyBell dropId="drop_1" dropName="Drop" />); });
    expect(notificationStatus).toHaveBeenCalledTimes(2);
    expect(bellOn(b)).toBe(false);
  });

  it('shows the bell off once signed out, while staying mounted', async () => {
    auth.isSignedIn = true; auth.userId = 'user_c';
    notificationStatus.mockResolvedValueOnce({ subscribed: true });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<DropNotifyBell dropId="drop_1" dropName="Drop" />); });
    expect(bellOn(r)).toBe(true);
    auth.isSignedIn = false; auth.userId = null;
    await act(async () => { r.update(<DropNotifyBell dropId="drop_1" dropName="Drop" />); });
    expect(bellOn(r)).toBe(false);
  });
});

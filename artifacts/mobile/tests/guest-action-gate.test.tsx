import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false, userId: null as string | null }));
vi.mock('@clerk/expo', () => ({ useAuth: () => auth }));
vi.mock('expo-router', () => ({
  usePathname: () => '/buyer-post-viewer',
  useGlobalSearchParams: () => ({ postId: 'public-video', index: '4' }),
}));
import { useSignInGate } from '../hooks/useSignInGate';
import { closeGuestSignIn, getGuestSignInRequest } from '../lib/guestSignIn';
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  closeGuestSignIn(false);
});
describe('action-only auth', () => {
  it('browsing never prompts, actions prompt and stop, and signing in does not replay them', async () => {
    let gate!: ReturnType<typeof useSignInGate>;
    const mutation = vi.fn();
    function Screen() { gate = useSignInGate(); return null; }
    await act(async () => { renderer = create(<Screen />); });
    expect(getGuestSignInRequest()).toBeNull();
    if (gate.requireSignIn()) mutation();
    expect(mutation).not.toHaveBeenCalled();
    expect(getGuestSignInRequest()?.returnTo).toBe('/buyer-post-viewer?postId=public-video&index=4');
    closeGuestSignIn();
    expect(getGuestSignInRequest()).toBeNull();
    Object.assign(auth, { isSignedIn: true, userId: 'signed-in-user' });
    await act(async () => renderer!.update(<Screen />));
    expect(mutation).not.toHaveBeenCalled();
    if (gate.requireSignIn()) mutation();
    expect(mutation).toHaveBeenCalledTimes(1);
    // A stale userId is not a session; neither is an auth-loading state.
    auth.isSignedIn = false;
    await act(async () => renderer!.update(<Screen />));
    expect(gate.requireSignIn()).toBe(false);
  });
});

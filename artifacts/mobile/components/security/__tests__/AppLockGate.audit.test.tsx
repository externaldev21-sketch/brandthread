/**
 * Audit (chunk 09): the delayed biometric prompt after locking must not fire
 * once the gate is gone (unmounted) or the person signed out.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: { isSignedIn: true, signOut: async () => {} },
  authenticate: vi.fn(async () => ({ success: true })),
}));

vi.mock('@clerk/expo', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/appLock', () => ({
  authenticateForAppLock: h.authenticate,
  getDeviceSecurity: async () => ({ hasDeviceSecurity: true, label: 'Face ID' }),
  loadAppLockSettings: async () => ({ enabled: true, graceSeconds: 0 }),
  saveAppLockSettings: async () => {},
  shouldLockOnResume: () => false,
  subscribeAppLock: () => () => {},
}));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { background: '#000', accent: '#fff', onAccent: '#000', card: '#111', border: '#333', text: '#fff', muted: '#888', error: '#f00' } }) }));
vi.mock('@/components/BrandthreadUI', () => ({ PrimaryButton: () => null, PressableScale: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import AppLockGate from '../AppLockGate';

afterEach(() => { vi.useRealTimers(); h.authenticate.mockClear(); h.auth.isSignedIn = true; });

async function mountLocked(): Promise<ReactTestRenderer> {
  vi.useFakeTimers();
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<AppLockGate />); });
  // Let the cold-start settings load resolve and lock() schedule the prompt.
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return r;
}

describe('AppLockGate', () => {
  it('does not raise the biometric prompt after unmounting', async () => {
    const r = await mountLocked();
    act(() => { r.unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it('does not raise the biometric prompt after signing out', async () => {
    const r = await mountLocked();
    h.auth.isSignedIn = false;
    await act(async () => { r.update(<AppLockGate />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it('still prompts while it stays mounted and signed in', async () => {
    await mountLocked();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(h.authenticate).toHaveBeenCalledTimes(1);
  });
});

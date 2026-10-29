/**
 * The bridge's cleanup deregistered the VoIP token through latest.current,
 * which after an account switch is already the NEW account's client: the
 * DELETE went out as the wrong account (and could delete the new account's
 * fresh registration of the same device token).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = vi.hoisted(() => ({
  available: true,
  onToken: null as null | ((t: { token: string; platform: 'ios' }) => void),
  init: vi.fn(() => () => {}),
  registerToken: vi.fn((cb: (t: { token: string; platform: 'ios' }) => void) => { kit.onToken = cb; return () => {}; }),
  reportAnswered: vi.fn(),
  endCall: vi.fn(),
}));

vi.mock('../nativeCallKit', () => ({ nativeCallKit: kit }));
vi.mock('../callIdentity', () => ({ setCallUserId: vi.fn(async () => {}) }));
vi.mock('@/services/manufacturerOrderFlow', () => ({ getCallAvailability: vi.fn(async () => true) }));

import { useNativeCallBridge } from '../useNativeCallBridge';

let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

const deregA = vi.fn(async () => {});
const deregB = vi.fn(async () => {});

function Bridge({ userId, enabled = true, dereg }: { userId: string; enabled?: boolean; dereg: (t: string) => Promise<unknown> }) {
  useNativeCallBridge({
    enabled, callsAvailable: true, userId, session: null,
    checkIncoming: () => {}, acceptCall: async () => {}, declineOrEndCall: async () => {},
    endOnServer: async () => {}, uploadToken: async () => {}, deregisterToken: dereg,
  });
  return null;
}

describe('native call token cleanup', () => {
  it('does not send the leaving account\'s DELETE through the new account on a switch', async () => {
    deregA.mockClear(); deregB.mockClear();
    await act(async () => { tree = create(<Bridge userId="user_a" dereg={deregA} />); });
    act(() => kit.onToken?.({ token: 'tok', platform: 'ios' }));
    await act(async () => { tree!.update(<Bridge userId="user_b" dereg={deregB} />); });
    expect(deregB).not.toHaveBeenCalled();
    expect(deregA).not.toHaveBeenCalled();
  });

  it('still drops the token when calls turn off for the same account', async () => {
    deregA.mockClear();
    await act(async () => { tree = create(<Bridge userId="user_a" dereg={deregA} />); });
    act(() => kit.onToken?.({ token: 'tok', platform: 'ios' }));
    await act(async () => { tree!.update(<Bridge userId="user_a" enabled={false} dereg={deregA} />); });
    expect(deregA).toHaveBeenCalledWith('tok');
  });
});

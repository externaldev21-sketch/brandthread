import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kit = vi.hoisted(() => ({
  available: true,
  init: vi.fn(() => () => {}),
  registerToken: vi.fn(() => () => {}),
  reportAnswered: vi.fn(),
  endCall: vi.fn(),
}));
const availability = vi.hoisted(() => ({ getCallAvailability: vi.fn(async () => false) }));

vi.mock('../nativeCallKit', () => ({ nativeCallKit: kit }));
vi.mock('../callIdentity', () => ({ setCallUserId: vi.fn(async () => {}) }));
vi.mock('@/services/manufacturerOrderFlow', () => availability);

import { useNativeCallBridge, useNativeCallsAvailable } from '../useNativeCallBridge';

let tree: ReactTestRenderer | undefined;

function Bridge({ enabled, userId }: { enabled: boolean; userId: string | null }) {
  const callsAvailable = useNativeCallsAvailable(enabled, userId);
  useNativeCallBridge({
    enabled,
    callsAvailable,
    userId,
    session: null,
    checkIncoming: () => {},
    acceptCall: async () => {},
    declineOrEndCall: async () => {},
    endOnServer: async () => {},
    uploadToken: async () => {},
    deregisterToken: async () => {},
  });
  return null;
}

async function render(el: React.ReactElement) {
  await act(async () => { tree = create(el); });
  // Let the availability request settle and the effects re-run.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  kit.available = true;
  kit.init.mockClear();
  kit.registerToken.mockClear();
  availability.getCallAvailability.mockReset().mockResolvedValue(false);
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

describe('native call bridge is inert while calls are unavailable', () => {
  it('no Agora credentials (configured: false): no CallKit / ConnectionService setup, no VoIP / FCM token', async () => {
    availability.getCallAvailability.mockResolvedValue(false);
    await render(<Bridge enabled userId="user_a" />);
    expect(availability.getCallAvailability).toHaveBeenCalledTimes(1);
    expect(kit.init).not.toHaveBeenCalled();
    expect(kit.registerToken).not.toHaveBeenCalled();
  });

  it('availability request fails: treated as unavailable', async () => {
    availability.getCallAvailability.mockRejectedValue(new Error('offline'));
    await render(<Bridge enabled userId="user_a" />);
    expect(kit.init).not.toHaveBeenCalled();
    expect(kit.registerToken).not.toHaveBeenCalled();
  });

  it('unknown availability (null) keeps the bridge inert', async () => {
    function Unknown() {
      useNativeCallBridge({
        enabled: true, callsAvailable: null, userId: 'user_a', session: null,
        checkIncoming: () => {}, acceptCall: async () => {}, declineOrEndCall: async () => {},
        endOnServer: async () => {}, uploadToken: async () => {}, deregisterToken: async () => {},
      });
      return null;
    }
    await render(<Unknown />);
    expect(kit.init).not.toHaveBeenCalled();
    expect(kit.registerToken).not.toHaveBeenCalled();
  });

  it('Expo Go / web (no native modules): never even asks for availability', async () => {
    kit.available = false;
    await render(<Bridge enabled userId="user_a" />);
    expect(availability.getCallAvailability).not.toHaveBeenCalled();
    expect(kit.init).not.toHaveBeenCalled();
    expect(kit.registerToken).not.toHaveBeenCalled();
  });

  it('signed out: never asks and stays inert', async () => {
    await render(<Bridge enabled={false} userId={null} />);
    expect(availability.getCallAvailability).not.toHaveBeenCalled();
    expect(kit.init).not.toHaveBeenCalled();
  });

  it('calls available (configured: true): wires the system call screen and registers the token', async () => {
    availability.getCallAvailability.mockResolvedValue(true);
    await render(<Bridge enabled userId="user_a" />);
    expect(kit.init).toHaveBeenCalledTimes(1);
    expect(kit.registerToken).toHaveBeenCalledTimes(1);
  });
});

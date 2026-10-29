import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ userId: 'user_a' as string | null }));
const fake = vi.hoisted(() => {
  let resolveStart: ((v: { callId: string }) => void) | null = null;
  const provider = {
    id: 'agora' as const,
    start: vi.fn(() => new Promise<{ callId: string }>((r) => { resolveStart = r; })),
    accept: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    setMuted: vi.fn(), setCameraOff: vi.fn(), setSpeakerOn: vi.fn(), switchCamera: vi.fn(),
    engineFor: vi.fn(() => null),
    subscribe: vi.fn(() => () => {}),
    onIncoming: vi.fn(() => () => {}),
    checkIncoming: vi.fn(async () => {}),
    connect: vi.fn(),
    dispose: vi.fn(),
  };
  return { provider, resolve: (callId: string) => resolveStart?.({ callId }) };
});
const api = vi.hoisted(() => ({
  call: { dm: { log: async () => ({ calls: [] as unknown[] }), end: async () => ({}) } },
  push: { registerVoipToken: async () => ({}), deregisterVoipToken: async () => ({}) },
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: async () => 't', isSignedIn: !!auth.userId, isLoaded: true, userId: auth.userId }),
  useUser: () => ({ user: auth.userId ? { id: auth.userId, fullName: 'Jordan' } : null }),
}));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));
vi.mock('@/lib/haptics', () => ({ hapticPrimaryAction: vi.fn(), hapticSuccessAction: vi.fn(), hapticDestructiveConfirm: vi.fn() }));
vi.mock('../native/useNativeCallBridge', () => ({ useNativeCallBridge: () => {}, useNativeCallsAvailable: () => null }));
vi.mock('../agoraCallProvider', () => ({
  CallStartError: class CallStartError extends Error {},
  createAgoraCallProvider: () => fake.provider,
}));

import { CallSessionProvider, useCallSession } from '../CallSessionContext';

let ctx: ReturnType<typeof useCallSession> | null = null;
function Probe() { ctx = useCallSession(); return null; }
let tree: ReactTestRenderer | undefined;

const peer = { id: 'them', name: 'Ava', initials: 'A', color: '#222' };
const input = { conversationId: 'conv-1', surface: 'buyer' as const, mode: 'voice' as const, peer, me: peer };

beforeEach(async () => {
  auth.userId = 'user_a';
  fake.provider.end.mockClear();
  fake.provider.subscribe.mockClear();
  await act(async () => { tree = create(<CallSessionProvider><Probe /></CallSessionProvider>); });
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; ctx = null; });

describe('CallSessionProvider (audit)', () => {
  it('ends the server call when the caller hangs up before the call was recorded', async () => {
    let placing: Promise<void> | undefined;
    await act(async () => { placing = ctx!.startCall(input); });
    expect(ctx!.session?.status).toBe('outgoing');
    await act(async () => { await ctx!.declineOrEndCall(); });
    expect(ctx!.session?.status).toBe('ended');
    await act(async () => { fake.resolve('call-9'); await placing; });
    expect(fake.provider.end).toHaveBeenCalledWith('call-9', 'cancelled');
    expect(fake.provider.subscribe).not.toHaveBeenCalled();
    expect(ctx!.session?.callId).not.toBe('call-9');
  });

  it('drops the previous account\'s call and call log when the signed-in account changes', async () => {
    await act(async () => { void ctx!.startCall(input); });
    expect(ctx!.session).not.toBeNull();
    auth.userId = 'user_b';
    await act(async () => { tree!.update(<CallSessionProvider><Probe /></CallSessionProvider>); });
    expect(ctx!.session).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmCallDto } from '../dmCallClient';

const engine = vi.hoisted(() => ({
  joined: [] as unknown[],
  left: 0,
  events: null as any,
  failJoin: false,
}));

vi.mock('@/lib/api', () => ({ API_BASE_URL: 'https://api.test' }));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: string, public code?: string) { super(body); }
  },
}));
vi.mock('../rtc/rtcEngine', () => ({
  createRtcEngine: (_mode: string, events: unknown) => {
    engine.events = events;
    return {
      join: async (creds: unknown) => { if (engine.failJoin) throw new Error('Microphone access is needed for calls.'); engine.joined.push(creds); },
      leave: async () => { engine.left += 1; },
      setMuted: vi.fn(), setCameraOff: vi.fn(), setSpeakerOn: vi.fn(), switchCamera: vi.fn(), renewToken: vi.fn(),
      getState: () => ({ joined: true, remoteUid: null, remoteVideoOn: false, localVideoOn: false }),
      onState: () => () => {}, attachVideo: () => {},
    };
  },
}));

import { CallStartError, createAgoraCallProvider } from '../agoraCallProvider';

const rtc = { appId: 'app', token: 'tok', channelName: 'dmcall_1', uid: 7, expiresAt: '2026-10-06T10:15:00.000Z' };
const dto = (patch: Partial<DmCallDto> = {}): DmCallDto => ({
  id: 'call-1', conversationId: 'conv-1', mode: 'voice', status: 'ringing', direction: 'outgoing',
  callerId: 'me', calleeId: 'them', peer: { id: 'them', name: 'Ava', initials: 'A', color: '#222', avatarUrl: null },
  createdAt: '2026-10-06T10:00:00.000Z', answeredAt: null, endedAt: null, durationSec: null, endReason: null, ...patch,
});

function makeApi() {
  return {
    create: vi.fn(async () => ({ call: dto(), rtc })),
    accept: vi.fn(async () => ({ call: dto({ direction: 'incoming', status: 'accepted', answeredAt: '2026-10-06T10:00:04.000Z' }), rtc })),
    decline: vi.fn(async () => ({ call: dto({ direction: 'incoming', status: 'declined', endedAt: '2026-10-06T10:00:04.000Z' }) })),
    end: vi.fn(async () => ({ call: dto({ status: 'cancelled', endedAt: '2026-10-06T10:00:04.000Z' }) })),
    token: vi.fn(async () => ({ rtc: { ...rtc, token: 'tok2' } })),
    get: vi.fn(async () => ({ call: dto() })),
    incoming: vi.fn(async () => ({ call: null as DmCallDto | null })),
  };
}

const me = () => ({ id: 'me', name: 'Jordan', initials: 'J', color: '#333' });
const input = { conversationId: 'conv-1', surface: 'buyer' as const, mode: 'voice' as const, peer: { id: 'them', name: 'Ava', initials: 'A', color: '#222' }, me: me() };

describe('agoraCallProvider', () => {
  beforeEach(() => { engine.joined = []; engine.left = 0; engine.failJoin = false; vi.useRealTimers(); });

  it('places a real call: server call record, then joins the Agora channel with its token', async () => {
    const api = makeApi();
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    const { callId } = await p.start(input);
    expect(callId).toBe('call-1');
    expect(api.create).toHaveBeenCalledWith({ conversationId: 'conv-1', mode: 'voice' });
    expect(engine.joined).toEqual([rtc]);
    p.dispose();
  });

  it('never calls the API signed out', async () => {
    const api = makeApi();
    const p = createAgoraCallProvider({ api, getToken: async () => null, isSignedIn: () => false, me });
    await expect(p.start(input)).rejects.toBeInstanceOf(CallStartError);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal (e.g. calling not configured) instead of faking a call', async () => {
    const api = makeApi();
    const { ApiError } = await import('@/lib/networkNotice');
    api.create.mockRejectedValueOnce(new (ApiError as any)(503, '{}', 'CALLING_NOT_CONFIGURED'));
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    await expect(p.start(input)).rejects.toMatchObject({ code: 'CALLING_NOT_CONFIGURED' });
    expect(engine.joined).toEqual([]);
  });

  it('ends the server call if the media channel cannot be joined', async () => {
    const api = makeApi();
    engine.failJoin = true;
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    await expect(p.start(input)).rejects.toMatchObject({ code: 'MEDIA' });
    expect(api.end).toHaveBeenCalledWith('call-1');
  });

  it('cancelling a ringing outgoing call ends it on the server and leaves the channel', async () => {
    const api = makeApi();
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    const { callId } = await p.start(input);
    const patches: unknown[] = [];
    p.subscribe(callId, (patch) => patches.push(patch));
    await p.end(callId, 'cancelled');
    expect(api.end).toHaveBeenCalledWith('call-1');
    expect(patches).toEqual([expect.objectContaining({ status: 'ended', endReason: 'cancelled' })]);
    expect(engine.left).toBe(1);
  });

  it('shows an incoming call from the server, accepts it and joins with the callee token', async () => {
    const api = makeApi();
    api.incoming.mockResolvedValueOnce({ call: dto({ direction: 'incoming' }) });
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    const seen: any[] = [];
    p.onIncoming((s) => seen.push(s));
    await p.checkIncoming();
    expect(seen).toEqual([expect.objectContaining({ callId: 'call-1', status: 'incoming', peer: expect.objectContaining({ name: 'Ava' }) })]);
    const patches: any[] = [];
    p.subscribe('call-1', (patch) => patches.push(patch));
    await p.accept('call-1');
    expect(api.accept).toHaveBeenCalledWith('call-1');
    expect(engine.joined).toEqual([rtc]);
    expect(patches.at(-1)).toMatchObject({ status: 'connected' });
    p.dispose();
  });

  it('declining a ringing incoming call uses the decline endpoint', async () => {
    const api = makeApi();
    api.incoming.mockResolvedValueOnce({ call: dto({ direction: 'incoming' }) });
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    await p.checkIncoming();
    await p.end('call-1', 'declined');
    expect(api.decline).toHaveBeenCalledWith('call-1');
    expect(api.end).not.toHaveBeenCalled();
    p.dispose();
  });

  it('renews the Agora token from the server before it expires', async () => {
    const api = makeApi();
    const p = createAgoraCallProvider({ api, getToken: async () => 't', isSignedIn: () => true, me });
    await p.start(input);
    engine.events.tokenWillExpire();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.token).toHaveBeenCalledWith('call-1');
    p.dispose();
  });
});

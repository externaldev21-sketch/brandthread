/**
 * The one door every community screen uses.
 *
 *   mode 'live'      signed-in → the real API (+ realtime WebSocket).
 *   mode 'demo'      dev web preview opened with `&demo=1` → lively local demo
 *                    data (lib/communities/demoStore.ts). Works offline.
 *   mode 'readonly'  signed out / default fresh preview (?bt_preview=…) → only
 *                    the PUBLIC list endpoint is called (real launch groups);
 *                    every write throws CommunityAuthRequiredError so the UI
 *                    can show a "Sign in to join" prompt. It never calls a
 *                    protected endpoint.
 *
 * Screens never branch on the mode except to decide copy ("Sign in to join").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { API_BASE_URL, useApi, type BrandthreadApi } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { demoStore, DEMO_ME_ID } from './demoStore';
import {
  CommunityAuthRequiredError,
  type Community, type CommunityAttachment, type CommunityEvent, type CommunityInvitePreview,
  type CommunityJoinRequest, type CommunityMember, type CommunityMessage, type CommunityMessagesPage,
  type CommunityReaction, type CreateCommunityInput, type UpdateCommunityInput,
} from './types';

export type CommunityClientMode = 'live' | 'demo' | 'readonly';

export interface CommunitySubscription {
  onEvent: (event: CommunityEvent) => void;
  /** Fires on every (re)connect — fetch `messages({ after: lastSeq })` here to catch up. */
  onConnected?: () => void;
  /** true while the socket can't connect and the screen should poll instead. */
  onFallback?: (active: boolean) => void;
}

export interface CommunityClient {
  mode: CommunityClientMode;
  /** The current user's id in this mode (demo: a demo id) — for "is this mine?" checks. */
  canWrite: boolean;
  list(params?: { q?: string; offset?: number }): Promise<{ communities: Community[]; nextOffset: number | null }>;
  mine(): Promise<Community[]>;
  get(id: string): Promise<Community>;
  create(input: CreateCommunityInput): Promise<Community>;
  update(id: string, input: UpdateCommunityInput): Promise<Community>;
  remove(id: string): Promise<void>;
  join(id: string): Promise<Community>;
  joinByCode(code: string): Promise<{ status: 'joined' | 'requested'; community?: Community }>;
  invitePreview(code: string): Promise<CommunityInvitePreview>;
  leave(id: string): Promise<void>;
  setMuted(id: string, muted: boolean): Promise<void>;
  markRead(id: string, seq?: number): Promise<void>;
  invite(id: string): Promise<{ code: string; url: string }>;
  resetInvite(id: string): Promise<{ code: string; url: string }>;
  members(id: string, params?: { q?: string; offset?: number }): Promise<{ memberCount: number; members: CommunityMember[]; nextOffset: number | null }>;
  removeMember(id: string, userId: string): Promise<void>;
  banMember(id: string, userId: string): Promise<void>;
  unban(id: string, userId: string): Promise<void>;
  bans(id: string): Promise<{ userId: string; name: string; bannedAt: string }[]>;
  setRole(id: string, userId: string, role: 'admin' | 'member' | 'owner'): Promise<void>;
  requests(id: string): Promise<CommunityJoinRequest[]>;
  approveRequest(id: string, userId: string): Promise<void>;
  denyRequest(id: string, userId: string): Promise<void>;
  messages(id: string, params?: { before?: number; after?: number; limit?: number }): Promise<CommunityMessagesPage>;
  send(id: string, body: { text?: string; attachments?: CommunityAttachment[]; replyToId?: string }): Promise<CommunityMessage>;
  deleteMessage(id: string, messageId: string): Promise<void>;
  react(id: string, messageId: string, reactionType: string): Promise<CommunityReaction[]>;
  unreact(id: string, messageId: string): Promise<CommunityReaction[]>;
  /** Moderated upload. Rejects with ApiError(422, code IMAGE_REJECTED) for gore/violence/nudity. */
  uploadPhoto(body: { data: string; mimeType: string }): Promise<{ url: string }>;
  /** Realtime channel while a chat is open. Returns an unsubscribe function. */
  subscribe(id: string, sub: CommunitySubscription): () => void;
  /** Subscribe to changes of the local joined/unread/muted state (demo mode only; no-op elsewhere). */
  onLocalChange(listener: () => void): () => void;
}

const noop = () => {};

function makeReadonlyClient(api: BrandthreadApi): CommunityClient {
  const deny = (): never => { throw new CommunityAuthRequiredError(); };
  return {
    mode: 'readonly', canWrite: false,
    list: (p) => api.communities.publicList(p),
    mine: async () => [],
    get: async () => deny(), create: async () => deny(), update: async () => deny(), remove: async () => deny(),
    join: async () => deny(), joinByCode: async () => deny(),
    invitePreview: (code) => api.communities.invitePreview(code), // public endpoint
    leave: async () => deny(), setMuted: async () => deny(), markRead: async () => {},
    invite: async () => deny(), resetInvite: async () => deny(),
    members: async () => deny(), removeMember: async () => deny(), banMember: async () => deny(), unban: async () => deny(),
    bans: async () => deny(), setRole: async () => deny(), requests: async () => deny(), approveRequest: async () => deny(),
    denyRequest: async () => deny(), messages: async () => deny(), send: async () => deny(), deleteMessage: async () => deny(),
    react: async () => deny(), unreact: async () => deny(), uploadPhoto: async () => deny(),
    subscribe: () => noop, onLocalChange: () => noop,
  };
}

function makeDemoClient(): CommunityClient {
  const page = <T,>(all: T[], offset = 0, limit = 30) => ({ items: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null });
  return {
    mode: 'demo', canWrite: true,
    list: async ({ q, offset } = {}) => { const p = page(demoStore.list(q), offset); return { communities: p.items, nextOffset: p.nextOffset }; },
    mine: async () => demoStore.mine(),
    get: async (id) => demoStore.get(id)!,
    create: async (input) => demoStore.create(input),
    update: async (id, input) => ({ ...demoStore.get(id)!, ...(input as Partial<Community>) } as Community),
    remove: async () => {},
    join: async (id) => demoStore.join(id)!,
    joinByCode: async () => ({ status: 'joined', community: demoStore.join('demo-c-embroidery') }),
    invitePreview: async () => ({ ...(demoStore.get('demo-c-embroidery') as Community) } as unknown as CommunityInvitePreview),
    leave: async (id) => demoStore.leave(id),
    setMuted: async (id, muted) => demoStore.setMuted(id, muted),
    markRead: async (id) => demoStore.markRead(id),
    invite: async (id) => ({ code: 'demo1234', url: `https://brandthread.app/community-join?code=demo1234&g=${id}` }),
    resetInvite: async (id) => ({ code: 'demo5678', url: `https://brandthread.app/community-join?code=demo5678&g=${id}` }),
    members: async (id, { offset } = {}) => { const all = demoStore.members(id); const p = page(all, offset, 50); return { memberCount: demoStore.get(id)?.memberCount ?? all.length, members: p.items, nextOffset: p.nextOffset }; },
    removeMember: async () => {}, banMember: async () => {}, unban: async () => {}, bans: async () => [], setRole: async () => {},
    requests: async () => [], approveRequest: async () => {}, denyRequest: async () => {},
    messages: async (id, { before, after, limit = 50 } = {}) => {
      const all = demoStore.messages(id);
      let rows = all;
      if (after !== undefined) rows = all.filter((m) => m.seq > after);
      else if (before !== undefined) rows = all.filter((m) => m.seq < before);
      const slice = after !== undefined ? rows.slice(0, limit) : rows.slice(-limit);
      const hasMore = after !== undefined ? rows.length > limit : rows.length > limit;
      return { messages: slice, hasMore, nextBefore: after === undefined && hasMore ? slice[0]?.seq ?? null : null, lastSeq: all[all.length - 1]?.seq ?? 0 };
    },
    send: async (id, body) => demoStore.send(id, body.text ?? '', body.attachments ?? [], body.replyToId),
    deleteMessage: async (id, messageId) => demoStore.deleteMessage(id, messageId),
    react: async (id, messageId, type) => demoStore.react(id, messageId, type),
    unreact: async (id, messageId) => demoStore.react(id, messageId, null),
    uploadPhoto: async ({ data, mimeType }) => ({ url: data.startsWith('data:') ? data : `data:${mimeType};base64,${data}` }),
    subscribe: (id, sub) => demoStore.subscribe(id, sub.onEvent),
    onLocalChange: (l) => demoStore.onChange(l),
  };
}

// ─── Live WebSocket subscription (backoff, same policy as lib/live/useLiveSocket) ──

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const FALLBACK_AFTER_ATTEMPTS = 5;

function openCommunitySocket(
  communityId: string,
  getToken: () => Promise<string | null>,
  sub: CommunitySubscription,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let attempts = 0;
  let fallback = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    attempts += 1;
    if (attempts >= FALLBACK_AFTER_ATTEMPTS && !fallback) { fallback = true; sub.onFallback?.(true); }
    timer = setTimeout(connect, Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS));
  };

  const connect = () => {
    if (stopped) return;
    getToken().then((token) => {
      if (stopped) return;
      if (!token) { schedule(); return; }
      const url = `${API_BASE_URL.replace(/^http/, 'ws')}/ws/community?communityId=${encodeURIComponent(communityId)}&token=${encodeURIComponent(token)}`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { schedule(); return; }
      socket = ws;
      ws.onopen = () => {
        if (stopped || socket !== ws) return;
        attempts = 0;
        if (fallback) { fallback = false; sub.onFallback?.(false); }
        sub.onConnected?.();
      };
      ws.onmessage = (e) => { try { sub.onEvent(JSON.parse(String(e.data)) as CommunityEvent); } catch { /* malformed frame */ } };
      ws.onerror = () => {};
      ws.onclose = (e) => {
        if (socket === ws) socket = null;
        // 4403 = removed/left/banned, 4404 = group deleted: don't reconnect, tell the screen.
        if (e && (e.code === 4403 || e.code === 4404)) {
          stopped = true;
          sub.onEvent(e.code === 4404 ? { type: 'community.deleted' } : { type: 'member.removed', userId: '' });
          return;
        }
        if (!stopped) schedule();
      };
    }).catch(() => { if (!stopped) schedule(); });
  };
  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    const s = socket; socket = null;
    if (s) { s.onopen = s.onmessage = s.onerror = s.onclose = null; try { s.close(); } catch { /* closed */ } }
  };
}

function makeLiveClient(api: BrandthreadApi, getToken: () => Promise<string | null>): CommunityClient {
  const c = api.communities;
  return {
    mode: 'live', canWrite: true,
    list: (p) => c.list(p),
    mine: () => c.mine(),
    get: (id) => c.get(id),
    create: (input) => c.create(input),
    update: (id, input) => c.update(id, input),
    remove: async (id) => { await c.remove(id); },
    join: (id) => c.join(id),
    joinByCode: (code) => c.joinByCode(code),
    invitePreview: (code) => c.invitePreview(code),
    leave: async (id) => { await c.leave(id); },
    setMuted: async (id, muted) => { await c.setMuted(id, muted); },
    markRead: async (id, seq) => { await c.markRead(id, seq); },
    invite: (id) => c.invite(id),
    resetInvite: (id) => c.resetInvite(id),
    members: (id, p) => c.members(id, p),
    removeMember: async (id, u) => { await c.removeMember(id, u); },
    banMember: async (id, u) => { await c.banMember(id, u); },
    unban: async (id, u) => { await c.unban(id, u); },
    bans: (id) => c.bans(id),
    setRole: async (id, u, role) => { await c.setRole(id, u, role); },
    requests: (id) => c.requests(id),
    approveRequest: async (id, u) => { await c.approveRequest(id, u); },
    denyRequest: async (id, u) => { await c.denyRequest(id, u); },
    messages: (id, p) => c.messages(id, p),
    send: (id, body) => c.send(id, body),
    deleteMessage: async (id, m) => { await c.deleteMessage(id, m); },
    react: async (id, m, t) => (await c.react(id, m, t)).reactions,
    unreact: async (id, m) => (await c.unreact(id, m)).reactions,
    uploadPhoto: (body) => c.uploadPhoto(body),
    subscribe: (id, sub) => openCommunitySocket(id, getToken, sub),
    onLocalChange: () => noop,
  };
}

export function resolveCommunityMode(signedIn: boolean): CommunityClientMode {
  if (isPreviewDemoMode()) return 'demo';
  if (isSellerDevPreview() || isBuyerDevPreview()) return 'readonly'; // preview must never call protected APIs
  return signedIn ? 'live' : 'readonly';
}

export function useCommunityClient(): CommunityClient {
  const api = useApi();
  const { isSignedIn, getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const mode = resolveCommunityMode(!!isSignedIn);
  return useMemo(() => {
    if (mode === 'demo') return makeDemoClient();
    if (mode === 'readonly') return makeReadonlyClient(api);
    return makeLiveClient(api, async () => getTokenRef.current());
  }, [api, mode]);
}

/** Id of the current user for "mine" checks on messages/members (demo mode has a fixed id). */
export function useCommunityMyId(): string | null {
  const { userId } = useAuth();
  return isPreviewDemoMode() ? DEMO_ME_ID : userId ?? null;
}

/**
 * Joined communities for inbox rows + tab badges. Refetches on focus-ish
 * triggers the caller wires up (call `reload`), polls lightly while mounted,
 * and reacts instantly to local changes in demo mode.
 */
export function useJoinedCommunities(pollMs = 20_000): { communities: Community[]; loading: boolean; reload: () => Promise<void> } {
  const client = useCommunityClient();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reload = useCallback(async () => {
    try {
      const rows = await client.mine();
      if (alive.current) setCommunities(rows);
    } catch { /* quiet — inbox must never break on this */ }
    finally { if (alive.current) setLoading(false); }
  }, [client]);
  useEffect(() => {
    void reload();
    const off = client.onLocalChange(() => { void reload(); });
    const timer = client.mode === 'live' ? setInterval(() => { void reload(); }, pollMs) : null;
    return () => { off(); if (timer) clearInterval(timer); };
  }, [client, reload, pollMs]);
  return { communities, loading, reload };
}

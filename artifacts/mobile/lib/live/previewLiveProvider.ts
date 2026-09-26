/**
 * PREVIEW LiveStreamProvider — fully local, zero network.
 *
 * Loops bundled runway clips as "live streams", ticks viewer counts up and
 * down, plays a scripted chat, rotates the pinned product and ends one
 * stream after a couple of minutes (so the pager's graceful-removal path is
 * visible). Pure: media (bundled video modules, poster images, catalog
 * products) is injected by lib/live/previewLiveMedia.ts so this module can
 * be unit tested without Expo.
 */
import type {
  LiveChatMessage, LiveEvent, LiveEventListener, LiveHost, LiveProduct, LiveStream,
  LiveStreamProvider, LiveVideoSource, LiveViewerAvatar, SuggestedCreator, UpcomingLive,
} from './types';
import { orderLiveStreams } from './liveOrdering';
import {
  PREVIEW_CHAT_SCRIPT, PREVIEW_CHAT_USERS, PREVIEW_HOST_REPLIES, PREVIEW_LIVE_BRANDS,
  PREVIEW_LIVE_STREAMS, PREVIEW_SUGGESTED_CREATORS, PREVIEW_UPCOMING_LIVES,
  seededRandom, tickViewerCount, type PreviewLiveStreamSeed,
} from './previewLiveData';

export interface PreviewLiveMedia {
  /** Playable source for runway clip `index` (0-9). */
  video(index: number): LiveVideoSource;
  /** Catalog product `index` (0-9) as a live product. */
  product(index: number): LiveProduct;
  /** Poster / avatar image for brand `index`, if any. */
  avatarUri?(index: number): string | null;
}

export interface PreviewLiveOptions {
  media: PreviewLiveMedia;
  seed?: number;
  /** Render the "nobody is live" empty state (`?bt_live=empty`). */
  forceEmpty?: boolean;
  viewerTickMs?: number;
  chatTickMs?: number;
  pinRotateMs?: number;
  /** Disable the scripted auto-end (tests). */
  disableAutoEnd?: boolean;
}

const VIEWER_COLORS = ['#2B2B2B', '#4A4A4A', '#6B6B6B', '#1A1A1A', '#8A8A8A'];

function hostFor(brandIndex: number, media: PreviewLiveMedia): LiveHost {
  const b = PREVIEW_LIVE_BRANDS[brandIndex];
  return {
    id: b.sellerId,
    name: b.name,
    handle: b.handle,
    initials: b.initials,
    avatarColor: b.avatarColor,
    avatarUri: media.avatarUri?.(brandIndex) ?? null,
    verified: b.verified,
  };
}

function initialsFor(username: string): string {
  const clean = username.replace(/[^a-z0-9]/gi, ' ').trim().split(/\s+/);
  return ((clean[0]?.[0] ?? '') + (clean[1]?.[0] ?? clean[0]?.[1] ?? '')).toUpperCase();
}

interface StreamState {
  seed: PreviewLiveStreamSeed;
  rand: () => number;
  viewerCount: number;
  likeCount: number;
  pinnedCursor: number;
  chatCursor: number;
  chat: LiveChatMessage[];
  ended: boolean;
  endedEmitted: boolean;
  endsAt: number | null;
  startedAt: number;
  listeners: Set<LiveEventListener>;
  timers: Array<ReturnType<typeof setInterval>>;
  msgSeq: number;
}

export function createPreviewLiveProvider(opts: PreviewLiveOptions): LiveStreamProvider {
  const {
    media, seed = 7, forceEmpty = false,
    viewerTickMs = 2200, chatTickMs = 1500, pinRotateMs = 20_000, disableAutoEnd = false,
  } = opts;
  const createdAt = Date.now();
  const followed = new Set<string>(
    PREVIEW_LIVE_STREAMS.filter(s => s.followed).map(s => PREVIEW_LIVE_BRANDS[s.brandIndex].sellerId),
  );
  const reminders = new Set<string>();
  const extraStreams: PreviewLiveStreamSeed[] = [];

  const states = new Map<string, StreamState>();
  function stateFor(seedRow: PreviewLiveStreamSeed): StreamState {
    let st = states.get(seedRow.id);
    if (!st) {
      const rand = seededRandom(seed * 1000 + seedRow.brandIndex * 37 + seedRow.videoIndex);
      st = {
        seed: seedRow,
        rand,
        viewerCount: seedRow.baseViewers,
        likeCount: seedRow.baseLikes,
        pinnedCursor: 0,
        chatCursor: Math.floor(rand() * PREVIEW_CHAT_SCRIPT.length),
        chat: [],
        ended: false,
        endedEmitted: false,
        endsAt: seedRow.endsAfterMs != null && !disableAutoEnd ? createdAt + seedRow.endsAfterMs : null,
        startedAt: createdAt - seedRow.startedMinutesAgo * 60_000,
        listeners: new Set(),
        timers: [],
        msgSeq: 0,
      };
      // A little history so the overlay is never empty on join.
      for (let i = 0; i < 4; i++) st.chat.push(scriptedMessage(st));
      states.set(seedRow.id, st);
    }
    return st;
  }

  function allSeeds(): PreviewLiveStreamSeed[] {
    return forceEmpty ? [] : [...PREVIEW_LIVE_STREAMS, ...extraStreams];
  }

  function seedById(id: string): PreviewLiveStreamSeed | undefined {
    return allSeeds().find(s => s.id === id);
  }

  function isEnded(st: StreamState): boolean {
    if (!st.ended && st.endsAt != null && Date.now() >= st.endsAt) st.ended = true;
    return st.ended;
  }

  function pinnedProductIndex(st: StreamState): number {
    const list = st.seed.productIndexes;
    return list[st.pinnedCursor % list.length];
  }

  function scriptedMessage(st: StreamState): LiveChatMessage {
    const line = PREVIEW_CHAT_SCRIPT[st.chatCursor % PREVIEW_CHAT_SCRIPT.length];
    st.chatCursor += 1;
    const host = PREVIEW_LIVE_BRANDS[st.seed.brandIndex];
    const product = media.product(pinnedProductIndex(st));
    const isHost = line.kind === 'host';
    const username = isHost ? host.name : PREVIEW_CHAT_USERS[Math.floor(st.rand() * PREVIEW_CHAT_USERS.length)];
    st.msgSeq += 1;
    return {
      id: `${st.seed.id}-m${st.msgSeq}`,
      userId: isHost ? host.sellerId : `preview-viewer-${username}`,
      username,
      text: line.text.replace('{product}', product.name).replace('{brand}', host.name),
      at: Date.now(),
      kind: line.kind ?? 'chat',
    };
  }

  function emit(st: StreamState, event: LiveEvent) {
    for (const l of [...st.listeners]) {
      try { l(event); } catch { /* a bad listener never breaks the ticker */ }
    }
  }

  function endStream(st: StreamState) {
    st.ended = true;
    stopTimers(st);
    if (st.endedEmitted) return;
    st.endedEmitted = true;
    emit(st, { type: 'ended', streamId: st.seed.id });
  }

  function stopTimers(st: StreamState) {
    st.timers.forEach(t => clearInterval(t));
    st.timers = [];
  }

  function startTimers(st: StreamState) {
    if (st.timers.length > 0) return;
    st.timers.push(setInterval(() => {
      if (isEnded(st)) { endStream(st); return; }
      st.viewerCount = tickViewerCount(st.viewerCount, st.seed.baseViewers, st.rand);
      emit(st, { type: 'viewers', streamId: st.seed.id, viewerCount: st.viewerCount });
      st.likeCount += 1 + Math.floor(st.rand() * 18);
      emit(st, { type: 'likes', streamId: st.seed.id, likeCount: st.likeCount });
    }, viewerTickMs));
    st.timers.push(setInterval(() => {
      if (isEnded(st)) { endStream(st); return; }
      // Skip ~1 in 4 ticks so the cadence feels human, not metronomic.
      if (st.rand() < 0.25) return;
      const msg = scriptedMessage(st);
      st.chat = [...st.chat, msg].slice(-40);
      emit(st, { type: 'chat', streamId: st.seed.id, messages: [msg] });
    }, chatTickMs));
    if (st.seed.productIndexes.length > 1) {
      st.timers.push(setInterval(() => {
        if (isEnded(st)) return;
        st.pinnedCursor += 1;
        emit(st, { type: 'pinned', streamId: st.seed.id, productId: media.product(pinnedProductIndex(st)).productId });
      }, pinRotateMs));
    }
  }

  function toStream(st: StreamState): LiveStream {
    const s = st.seed;
    const host = hostFor(s.brandIndex, media);
    const products = s.productIndexes.map(i => media.product(i));
    const topViewers: LiveViewerAvatar[] = [0, 1, 2].map(k => {
      const username = PREVIEW_CHAT_USERS[(s.brandIndex * 3 + k * 5) % PREVIEW_CHAT_USERS.length];
      return { id: `${s.id}-v${k}`, initials: initialsFor(username), color: VIEWER_COLORS[(s.brandIndex + k) % VIEWER_COLORS.length] };
    });
    return {
      id: s.id,
      host,
      title: s.title,
      viewerCount: st.viewerCount,
      likeCount: st.likeCount,
      startedAt: st.startedAt,
      followedByViewer: followed.has(host.id),
      products,
      pinnedProductId: products.length ? media.product(pinnedProductIndex(st)).productId : null,
      topViewers,
      video: media.video(s.videoIndex),
    };
  }

  return {
    id: 'preview',

    async listLive() {
      const live = allSeeds().map(stateFor).filter(st => !isEnded(st));
      return orderLiveStreams(live.map(toStream));
    },

    async listUpcoming(): Promise<UpcomingLive[]> {
      const now = Date.now();
      return PREVIEW_UPCOMING_LIVES.map(u => ({
        id: u.id,
        host: hostFor(u.brandIndex, media),
        title: u.title,
        startsAt: now + u.startsInMinutes * 60_000,
        reminderSet: reminders.has(u.id),
      }));
    },

    async listSuggestedCreators(): Promise<SuggestedCreator[]> {
      return PREVIEW_SUGGESTED_CREATORS.map(i => ({
        host: hostFor(i, media),
        followerCount: PREVIEW_LIVE_BRANDS[i].followerCount,
        following: followed.has(PREVIEW_LIVE_BRANDS[i].sellerId),
      }));
    },

    async join(streamId) {
      const seedRow = seedById(streamId);
      if (!seedRow) return { ok: false, recentChat: [] };
      const st = stateFor(seedRow);
      if (isEnded(st)) return { ok: false, recentChat: [] };
      st.viewerCount += 1;
      return { ok: true, recentChat: st.chat.slice(-5) };
    },

    async leave(streamId) {
      const st = states.get(streamId);
      if (st && !st.ended) st.viewerCount = Math.max(1, st.viewerCount - 1);
    },

    subscribe(streamId, listener) {
      const seedRow = seedById(streamId);
      if (!seedRow) return () => {};
      const st = stateFor(seedRow);
      st.listeners.add(listener);
      if (isEnded(st)) {
        // Deliver asynchronously so callers can finish wiring state first.
        const t = setTimeout(() => listener({ type: 'ended', streamId }), 0);
        return () => { clearTimeout(t); st.listeners.delete(listener); };
      }
      startTimers(st);
      let endTimer: ReturnType<typeof setTimeout> | null = null;
      if (st.endsAt != null) {
        endTimer = setTimeout(() => endStream(st), Math.max(0, st.endsAt - Date.now()));
      }
      return () => {
        if (endTimer) clearTimeout(endTimer);
        st.listeners.delete(listener);
        if (st.listeners.size === 0) stopTimers(st);
      };
    },

    async sendChat(streamId, text) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Message is empty');
      const st = states.get(streamId);
      const msg: LiveChatMessage = { id: `${streamId}-you-${Date.now()}`, userId: 'preview-you', username: 'you', text: trimmed.slice(0, 500), at: Date.now(), kind: 'chat' };
      if (!st || st.ended) throw new Error('This live has ended');
      st.chat = [...st.chat, msg].slice(-40);
      emit(st, { type: 'chat', streamId, messages: [msg] });
      // The host acknowledges the viewer a moment later.
      setTimeout(() => {
        if (st.ended) return;
        const host = PREVIEW_LIVE_BRANDS[st.seed.brandIndex];
        st.msgSeq += 1;
        const reply: LiveChatMessage = {
          id: `${streamId}-m${st.msgSeq}`,
          userId: host.sellerId,
          username: host.name,
          text: PREVIEW_HOST_REPLIES[st.msgSeq % PREVIEW_HOST_REPLIES.length].replace('{user}', '@you'),
          at: Date.now(),
          kind: 'host',
        };
        st.chat = [...st.chat, reply].slice(-40);
        emit(st, { type: 'chat', streamId, messages: [reply] });
      }, 2400);
      return msg;
    },

    async sendLike(streamId) {
      const st = states.get(streamId);
      if (!st || st.ended) return;
      st.likeCount += 1;
    },

    async setReminder(upcomingId, on) {
      if (on) reminders.add(upcomingId); else reminders.delete(upcomingId);
    },

    async setFollowing(hostId, on) {
      if (on) followed.add(hostId); else followed.delete(hostId);
    },

    async start(input) {
      const id = `preview-live-you-${extraStreams.length + 1}`;
      extraStreams.push({
        id, brandIndex: 0, videoIndex: 3, title: input.title || 'Live now',
        baseViewers: 1, baseLikes: 0, startedMinutesAgo: 0, followed: false,
        productIndexes: input.productIds.length ? [0] : [3],
      });
      return { streamId: id };
    },

    async stop(streamId) {
      const seedRow = seedById(streamId);
      if (!seedRow) return;
      endStream(stateFor(seedRow));
    },
  };
}

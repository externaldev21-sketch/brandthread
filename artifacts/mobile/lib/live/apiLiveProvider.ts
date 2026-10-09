/**
 * REAL LiveStreamProvider backed by the existing `/api/live/*` routes.
 *
 * What is real here: the list of live streams (followed first, then by
 * viewers — `GET /api/live/feed`), joining/leaving (viewer counts), live chat
 * (post + poll), the pinned/highlighted product the seller sets from the
 * seller-live screen, and ending (status flips to `ended`).
 *
 * What is NOT real yet:
 *  - Video. The backend issues Agora RTC tokens, but rendering requires the
 *    native `react-native-agora` SDK and AGORA_APP_ID / AGORA_APP_CERTIFICATE,
 *    neither of which is configured. Streams therefore carry
 *    `{ kind: 'rtc', vendor: 'agora' }` and the pager shows the poster with
 *    an "Open player" hand-off to the existing /buyer-live Agora screen.
 *  - Realtime transport: `subscribe` joins the stream's `/ws/live` room
 *    (api-server ws/liveHub.ts) for chat, viewer counts and the pinned
 *    product, and falls back to the previous 3s poll only while the socket
 *    is down (see lib/live/liveRoomSocket.ts).
 *  - Like counts: no counter exists, so `sendLike` is a no-op.
 *  - Scheduled lives / reminders are real (routes/live-commerce.ts); see
 *    lib/live/liveCommerce.ts.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { openLiveRoomSocket } from './liveRoomSocket';
import { setSellerFollowing } from '@/services/socialService';
import type {
  LiveChatMessage, LiveHost, LiveProduct, LiveStream, LiveStreamProvider, SuggestedCreator,
} from './types';
import { orderLiveStreams } from './liveOrdering';
import {
  fetchUpcomingLives, pinnedProductIdFromRow, setScheduledLiveReminder,
} from './liveCommerce';

const POLL_MS = 3000;
const LIVE_SAFETY_POLL_MS = 15_000;
const MONO = ['#1F1F1F', '#3A3A3A', '#555555', '#2B2B2B', '#474747'];

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return MONO[Math.abs(h) % MONO.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '•';
}

type Row = Record<string, any>;

export function hostFromRow(row: Row): LiveHost {
  const name: string = row.brand_name || row.seller_name || 'Live';
  return {
    id: row.seller_id,
    name,
    handle: row.username ? `@${row.username}` : '',
    initials: initialsOf(name),
    avatarColor: colorFor(String(row.seller_id ?? name)),
    avatarUri: row.avatar_url ?? null,
    verified: row.verified === true,
  };
}

export function productsFromTags(tags: unknown): { products: LiveProduct[]; pinned: string | null } {
  const list = Array.isArray(tags) ? tags : [];
  const products: LiveProduct[] = list
    .filter((t: any) => t && typeof t.productId === 'string')
    .map((t: any) => ({
      productId: t.productId,
      name: t.productName ?? 'Product',
      priceCents: Number(t.priceCents) || 0,
      imageUri: t.imageUri ?? null,
    }));
  const highlighted = list.find((t: any) => t?.highlighted)?.productId ?? null;
  return { products, pinned: highlighted ?? products[0]?.productId ?? null };
}

export function streamFromRow(row: Row): LiveStream {
  const { products } = productsFromTags(row.product_tags);
  return {
    id: row.id,
    host: hostFromRow(row),
    title: row.title ?? '',
    viewerCount: Number(row.viewer_count) || 0,
    likeCount: 0,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
    followedByViewer: row.followed === true,
    products,
    pinnedProductId: pinnedProductIdFromRow(row),
    topViewers: [],
    video: { kind: 'rtc', vendor: 'agora', posterUri: row.thumbnail_url ?? null },
  };
}

function chatFromRow(row: Row): LiveChatMessage {
  return {
    id: String(row.id),
    userId: row.user_id,
    username: row.display_name ?? 'Viewer',
    text: row.message ?? '',
    at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    kind: 'chat',
  };
}

const get = <T,>(path: string) => serviceRequest<T>(path, {}, false);
const post = <T,>(path: string, body: unknown = {}) =>
  serviceRequest<T>(path, { method: 'POST', body: JSON.stringify(body) }, false);

export function createApiLiveProvider(): LiveStreamProvider {
  return {
    id: 'api',

    async listLive() {
      const data = await get<{ streams: Row[] }>('/api/live/feed');
      return orderLiveStreams((data.streams ?? []).map(streamFromRow));
    },

    async listUpcoming() {
      try {
        const scheduled = await fetchUpcomingLives();
        return scheduled.map(s => ({
          id: s.id,
          host: hostFromRow({ seller_id: s.sellerId, brand_name: s.seller.name, username: s.seller.username, avatar_url: s.seller.avatarUrl, verified: s.seller.verified }),
          title: s.title,
          startsAt: new Date(s.startsAt).getTime(),
          reminderSet: s.reminderSet,
        }));
      } catch {
        return [];
      }
    },

    async listSuggestedCreators(): Promise<SuggestedCreator[]> {
      try {
        const data = await get<{ brands: Array<{ sellerId: string; name: string; handle: string; color: string; initials: string; followerCount: number }> }>(
          '/api/public/search/suggested?limit=6',
        );
        return (data.brands ?? []).map(b => ({
          host: { id: b.sellerId, name: b.name, handle: b.handle, initials: b.initials, avatarColor: b.color, verified: false },
          followerCount: b.followerCount,
          following: false,
        }));
      } catch {
        return [];
      }
    },

    async join(streamId) {
      await post(`/api/live/${encodeURIComponent(streamId)}/join`);
      const data = await get<{ comments: Row[] }>(`/api/live/${encodeURIComponent(streamId)}/comments`).catch(() => ({ comments: [] }));
      return { ok: true, recentChat: (data.comments ?? []).slice(0, 5).reverse().map(chatFromRow) };
    },

    async leave(streamId) {
      await post(`/api/live/${encodeURIComponent(streamId)}/leave`).catch(() => {});
    },

    subscribe(streamId, listener) {
      let since = new Date().toISOString();
      let stopped = false;
      let lastPinned: string | null | undefined;
      const id = encodeURIComponent(streamId);
      async function poll() {
        try {
          const [comments, detail] = await Promise.all([
            get<{ comments: Row[] }>(`/api/live/${id}/comments?since=${encodeURIComponent(since)}`),
            get<{ stream: Row }>(`/api/live/${id}`),
          ]);
          if (stopped) return;
          const fresh = (comments.comments ?? []).slice().reverse().map(chatFromRow);
          if (fresh.length) {
            since = new Date(fresh[fresh.length - 1].at).toISOString();
            listener({ type: 'chat', streamId, messages: fresh });
          }
          const s = detail.stream;
          if (!s || s.status !== 'live') { listener({ type: 'ended', streamId }); return; }
          listener({ type: 'viewers', streamId, viewerCount: Number(s.viewer_count) || 0 });
          const pinned = pinnedProductIdFromRow(s);
          if (pinned !== lastPinned) {
            lastPinned = pinned;
            listener({ type: 'pinned', streamId, productId: pinned });
          }
        } catch (e: any) {
          if (!stopped && (e?.status === 404 || e?.status === 410)) listener({ type: 'ended', streamId });
        }
      }
      // Live chat, viewer counts and the pinned product arrive over the
      // stream's socket; `poll` runs every 3s only while it is down, plus
      // once on every (re)connect to catch up, and every 15s as a safety net
      // for the end of the stream.
      const seen = new Set<string>();
      let timer: ReturnType<typeof setInterval> | null = setInterval(poll, POLL_MS);
      void poll();
      const room = openLiveRoomSocket(streamId, {
        onConnected() {
          if (timer) clearInterval(timer);
          timer = setInterval(poll, LIVE_SAFETY_POLL_MS);
          void poll();
        },
        onDisconnected() {
          if (stopped) return;
          if (timer) clearInterval(timer);
          timer = setInterval(poll, POLL_MS);
        },
        onEvent(event) {
          if (stopped) return;
          if (event.type === 'comment' && event.comment) {
            const msg = chatFromRow(event.comment);
            if (seen.has(msg.id)) return;
            seen.add(msg.id);
            if (msg.at > new Date(since).getTime()) since = new Date(msg.at).toISOString();
            listener({ type: 'chat', streamId, messages: [msg] });
          } else if (event.type === 'viewerCount' && typeof event.count === 'number') {
            listener({ type: 'viewers', streamId, viewerCount: event.count as number });
          } else if (event.type === 'pinned') {
            const pinnedId = typeof event.productId === 'string' ? event.productId : null;
            lastPinned = pinnedId;
            listener({ type: 'pinned', streamId, productId: pinnedId });
          } else if (event.type === 'ended') {
            listener({ type: 'ended', streamId });
          }
        },
      });
      return () => { stopped = true; if (timer) clearInterval(timer); room.close(); };
    },

    async sendChat(streamId, text) {
      const data = await post<{ comment: Row }>(`/api/live/${encodeURIComponent(streamId)}/comment`, { message: text.trim() });
      return chatFromRow(data.comment);
    },

    async sendLike() {
      // No live-like counter on the backend yet; the heart burst is local.
    },

    async setReminder(upcomingId, on) {
      await setScheduledLiveReminder(upcomingId, on);
    },

    async setFollowing(hostId, following) {
      await setSellerFollowing(hostId, following);
    },

    async start(input) {
      const data = await post<{ stream: { id: string } }>('/api/live/start', {
        title: input.title,
        productTags: input.productIds.map(productId => ({ productId })),
      });
      return { streamId: data.stream.id };
    },

    async stop(streamId) {
      await post(`/api/live/${encodeURIComponent(streamId)}/end`);
    },
  };
}

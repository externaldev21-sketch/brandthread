/**
 * Real-time transport for buyer-live.tsx / seller-live.tsx.
 *
 * Replaces the old `setInterval(poll, 3000)` loop with a real WebSocket
 * connection to the api-server's `/ws/live` room for this stream (see
 * artifacts/api-server/src/ws/liveHub.ts). On connect (and every
 * reconnect), the caller is told to do a one-shot HTTP backfill (the
 * existing GET stream/comments endpoints) to catch anything missed while
 * disconnected — this hook only carries live updates from that point on.
 *
 * Reconnects with capped exponential backoff. If the socket genuinely can't
 * connect after a few tries, `onFallback(true)` tells the caller to fall
 * back to slow HTTP polling instead of a frozen screen — silently, no error
 * UI. A heartbeat is sent over the socket every ~15s while connected, which
 * the server uses for presence-based viewer counts (see
 * jobs/liveViewersPresence.ts); when in fallback mode the caller is
 * responsible for calling the HTTP heartbeat route instead (see
 * `api.live.heartbeat` and the fallback effect in the screens).
 *
 * Not used in preview mode (`?bt_preview`) — the preview live pager
 * (app/live.tsx via lib/live/previewLiveProvider.ts) never has a real
 * stream id or reaches buyer-live.tsx/seller-live.tsx in the first place
 * (see lib/live/types.ts's `video.kind`), so callers don't need to special-
 * case it here; `enabled: false` is available regardless, for symmetry.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { API_BASE_URL } from '@/lib/api';

export type LiveSocketEvent =
  | { type: 'comment'; comment: any }
  | { type: 'products'; productTags: any[] }
  | { type: 'viewerCount'; count: number }
  | { type: 'pinned'; productId: string | null }
  | { type: 'liveCode'; code: { id: string; code: string; type: string; value: number } }
  // Moderation + co-host (routes/live-moderation.ts, routes/live-cohost.ts)
  | { type: 'comment_pinned'; comment: any | null }
  | { type: 'comment_removed'; commentId: string }
  | { type: 'moderation'; slowModeSeconds: number }
  | { type: 'user_muted'; userId: string }
  | { type: 'user_banned'; userId: string }
  | { type: 'cohosts'; cohosts: any[] }
  | { type: 'cohost_removed'; userId: string }
  /** Synthesised client-side when the server closes this socket with 4003 (host banned this viewer). */
  | { type: 'removed' };

interface UseLiveSocketOptions {
  streamId: string | undefined;
  /** false while loading, ended, or in preview mode — no connection attempted. */
  enabled: boolean;
  onEvent: (event: LiveSocketEvent) => void;
  /** Fired once per successful connect (including reconnects) — do a one-shot HTTP backfill here. */
  onConnected: () => void;
  /** Fired when the socket enters/leaves slow-polling fallback mode. */
  onFallback: (active: boolean) => void;
  /** seller-live.tsx: the broadcaster connects as host — it receives the
   * same comment/product/viewerCount broadcasts but is never counted as a
   * viewer in the presence table (see ws/liveHub.ts). */
  asHost?: boolean;
}

const HEARTBEAT_MS = 15_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const FALLBACK_AFTER_ATTEMPTS = 5;

function wsUrlFor(streamId: string, token: string, asHost: boolean): string {
  const base = API_BASE_URL.replace(/^http/, 'ws');
  const role = asHost ? '&role=host' : '';
  return `${base}/ws/live?streamId=${encodeURIComponent(streamId)}&token=${encodeURIComponent(token)}${role}`;
}

export function useLiveSocket({ streamId, enabled, onEvent, onConnected, onFallback, asHost = false }: UseLiveSocketOptions): void {
  const { getToken } = useAuth();

  // Latest callbacks in refs so `connect` (stable across renders) never
  // closes over a stale prop — only [streamId, enabled] should ever
  // re-trigger a fresh connection.
  const onEventRef = useRef(onEvent);
  const onConnectedRef = useRef(onConnected);
  const onFallbackRef = useRef(onFallback);
  onEventRef.current = onEvent;
  onConnectedRef.current = onConnected;
  onFallbackRef.current = onFallback;

  const socketRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const fallbackActiveRef = useRef(false);
  const stoppedRef = useRef(false);

  const teardownSocket = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch { /* already closed */ }
    }
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current) return;
    attemptsRef.current += 1;
    if (attemptsRef.current >= FALLBACK_AFTER_ATTEMPTS && !fallbackActiveRef.current) {
      fallbackActiveRef.current = true;
      onFallbackRef.current(true);
    }
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attemptsRef.current - 1), MAX_BACKOFF_MS);
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => connectRef.current(), delay);
  }, []);

  const connect = useCallback(() => {
    if (stoppedRef.current || !streamId) return;
    teardownSocket();

    void getToken().then((token) => {
      if (stoppedRef.current || !token) {
        if (!stoppedRef.current) scheduleReconnect();
        return;
      }
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrlFor(streamId, token, asHost));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (stoppedRef.current || socketRef.current !== socket) return;
        attemptsRef.current = 0;
        if (fallbackActiveRef.current) {
          fallbackActiveRef.current = false;
          onFallbackRef.current(false);
        }
        onConnectedRef.current();
        heartbeatRef.current = setInterval(() => {
          try { socket.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* socket closing */ }
        }, HEARTBEAT_MS);
      };
      socket.onmessage = (event) => {
        try { onEventRef.current(JSON.parse(String(event.data))); } catch { /* malformed frame */ }
      };
      socket.onerror = () => { /* onclose follows and handles reconnect */ };
      socket.onclose = (closeEvent: any) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        // 4003: the host banned this viewer — don't reconnect-loop against a server that will refuse.
        if (closeEvent?.code === 4003) {
          stoppedRef.current = true;
          try { onEventRef.current({ type: 'removed' }); } catch { /* ignore */ }
          return;
        }
        if (!stoppedRef.current) scheduleReconnect();
      };
    }).catch(() => {
      if (!stoppedRef.current) scheduleReconnect();
    });
  }, [streamId, getToken, teardownSocket, scheduleReconnect, asHost]);

  connectRef.current = connect;

  useEffect(() => {
    stoppedRef.current = false;
    attemptsRef.current = 0;
    fallbackActiveRef.current = false;
    if (enabled && streamId) connect();
    return () => {
      stoppedRef.current = true;
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      teardownSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only streamId/enabled should restart the connection
  }, [streamId, enabled]);
}

/**
 * Seller-scoped realtime channel (`/ws/seller`, see
 * artifacts/api-server/src/ws/sellerHub.ts). Same connection pattern as
 * lib/live/useLiveSocket.ts: Clerk token in the query string, capped
 * exponential backoff on drop, and `onConnected` on every (re)connect so
 * the caller can backfill over HTTP whatever it missed while offline.
 *
 * `onStatus(false)` fires whenever the socket isn't open (connecting,
 * backing off, or given up), so the caller can run its slow HTTP poll
 * only while realtime is unavailable.
 *
 * The caller decides when to connect via `enabled` — the dashboard passes
 * "screen focused and not a preview", so nothing stays open in the
 * background.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { API_BASE_URL, getStoreContext } from '@/lib/api';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function wsUrlFor(token: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws');
  // Same store selection the HTTP X-Store-Context header makes ('own' or a
  // team membership id). 'joined'/unset → the caller's own store.
  const store = getStoreContext();
  const storeParam = store && store !== 'joined' ? `&store=${encodeURIComponent(store)}` : '';
  return `${base}/ws/seller?token=${encodeURIComponent(token)}${storeParam}`;
}

interface UseSellerSocketOptions {
  enabled: boolean;
  onEvent: (event: unknown) => void;
  onConnected: () => void;
  onStatus: (connected: boolean) => void;
  /** Changing this reconnects (e.g. after the store switcher changes store). */
  resetKey?: number;
}

export function useSellerSocket({ enabled, onEvent, onConnected, onStatus, resetKey = 0 }: UseSellerSocketOptions): void {
  const { getToken } = useAuth();

  const onEventRef = useRef(onEvent);
  const onConnectedRef = useRef(onConnected);
  const onStatusRef = useRef(onStatus);
  onEventRef.current = onEvent;
  onConnectedRef.current = onConnected;
  onStatusRef.current = onStatus;

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const stoppedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  const teardownSocket = useCallback(() => {
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

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current) return;
    onStatusRef.current(false);
    attemptsRef.current += 1;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attemptsRef.current - 1), MAX_BACKOFF_MS);
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => connectRef.current(), delay);
  }, []);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    teardownSocket();
    void getToken().then((token) => {
      if (stoppedRef.current) return;
      if (!token) { scheduleReconnect(); return; }
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrlFor(token));
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;
      socket.onopen = () => {
        if (stoppedRef.current || socketRef.current !== socket) return;
        attemptsRef.current = 0;
        onStatusRef.current(true);
        onConnectedRef.current();
      };
      socket.onmessage = (event) => {
        try { onEventRef.current(JSON.parse(String(event.data))); } catch { /* malformed frame */ }
      };
      socket.onerror = () => { /* onclose follows */ };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!stoppedRef.current) scheduleReconnect();
      };
    }).catch(() => {
      if (!stoppedRef.current) scheduleReconnect();
    });
  }, [getToken, teardownSocket, scheduleReconnect]);

  connectRef.current = connect;

  useEffect(() => {
    stoppedRef.current = false;
    attemptsRef.current = 0;
    if (enabled) {
      onStatusRef.current(false);
      connect();
    }
    return () => {
      stoppedRef.current = true;
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
      teardownSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `enabled`/`resetKey` should restart the connection
  }, [enabled, resetKey]);
}

/**
 * Non-React connection to one live stream's `/ws/live` room (api-server
 * ws/liveHub.ts) for the live feed pager (lib/live/apiLiveProvider.ts).
 * buyer-live / seller-live use the hook in ./useLiveSocket.ts; this is the
 * same protocol for code that isn't a component.
 *
 * Connects as a viewer with the active session token, sends the presence
 * heartbeat every 15s, reconnects with capped backoff, and tells the caller
 * when it is up or down so the caller can run its HTTP poll only while the
 * socket is down. Never connects without a token (signed out / preview).
 */
import { API_BASE_URL } from '@/lib/api';
import { getServiceToken } from '@/lib/serviceConfig';

export type LiveRoomEvent =
  | { type: 'comment'; comment: Record<string, any> }
  | { type: 'viewerCount'; count: number }
  | { type: 'pinned'; productId: string | null }
  | { type: 'products'; productTags: unknown[] }
  | { type: 'ended' }
  | { type: string; [key: string]: unknown };

export interface LiveRoomHandlers {
  onEvent: (event: LiveRoomEvent) => void;
  /** Fired on every successful (re)connect — do a one-shot catch-up here. */
  onConnected: () => void;
  /** Fired when an open socket drops — resume polling here. */
  onDisconnected: () => void;
}

const HEARTBEAT_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

export function liveRoomUrl(apiBase: string, streamId: string, token: string): string {
  const base = apiBase.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${base}/ws/live?streamId=${encodeURIComponent(streamId)}&token=${encodeURIComponent(token)}`;
}

export function openLiveRoomSocket(streamId: string, handlers: LiveRoomHandlers): { close: () => void } {
  let stopped = false;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  function clearHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function scheduleRetry() {
    if (stopped || retry) return;
    attempts += 1;
    retry = setTimeout(() => { retry = null; void connect(); }, Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS));
  }

  async function connect() {
    if (stopped || typeof WebSocket === 'undefined' || !API_BASE_URL) return;
    const token = await getServiceToken();
    if (stopped) return;
    if (!token) { scheduleRetry(); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(liveRoomUrl(API_BASE_URL, streamId, token)); } catch { scheduleRetry(); return; }
    socket = ws;
    let opened = false;
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      opened = true;
      attempts = 0;
      heartbeat = setInterval(() => {
        try { ws.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* closing */ }
      }, HEARTBEAT_MS);
      handlers.onConnected();
    };
    ws.onmessage = (e) => {
      let event: LiveRoomEvent;
      try { event = JSON.parse(String(e.data)); } catch { return; }
      if (event && typeof event.type === 'string') handlers.onEvent(event);
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = (closeEvent: { code?: number }) => {
      if (socket !== ws) return;
      socket = null;
      clearHeartbeat();
      if (stopped) return;
      if (opened) handlers.onDisconnected();
      // 4003: the host removed this viewer; the server will keep refusing.
      if (closeEvent?.code === 4003) return;
      scheduleRetry();
    };
  }

  void connect();

  return {
    close() {
      stopped = true;
      if (retry) { clearTimeout(retry); retry = null; }
      clearHeartbeat();
      const s = socket;
      socket = null;
      if (s) {
        s.onopen = null; s.onmessage = null; s.onerror = null; s.onclose = null;
        try { s.close(); } catch { /* already closed */ }
      }
    },
  };
}

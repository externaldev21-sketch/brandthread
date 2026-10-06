/**
 * Realtime call events for the signed-in user — `GET /ws/calls?token=…`
 * (artifacts/api-server/src/ws/callHub.ts). Delivers `call.incoming` (someone
 * is ringing you) and `call.updated` (accepted / declined / missed / ended)
 * the instant they happen on the other device. Reconnects with backoff; the
 * provider also polls an active call and re-checks incoming calls on
 * reconnect / app foreground, so a dropped socket never loses a call.
 */
import { API_BASE_URL } from '@/lib/api';
import type { DmCallDto } from './dmCallClient';

export type CallEvent =
  | { type: 'call.incoming'; call: DmCallDto }
  | { type: 'call.updated'; call: DmCallDto };

export function parseCallEvent(raw: unknown): CallEvent | null {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') return null;
    const { type, call } = data as { type?: unknown; call?: unknown };
    if ((type !== 'call.incoming' && type !== 'call.updated') || !call || typeof call !== 'object') return null;
    if (typeof (call as DmCallDto).id !== 'string' || typeof (call as DmCallDto).status !== 'string') return null;
    return { type, call: call as DmCallDto };
  } catch {
    return null;
  }
}

export function callSocketUrl(token: string, base = API_BASE_URL): string {
  return `${base.replace(/^http/, 'ws')}/ws/calls?token=${encodeURIComponent(token)}`;
}

export interface CallEventsConnection {
  close(): void;
}

export function connectCallEvents(opts: {
  getToken: () => Promise<string | null>;
  onEvent: (event: CallEvent) => void;
  onConnected?: () => void;
}): CallEventsConnection {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(open, delay);
  };

  function open() {
    if (closed || typeof WebSocket === 'undefined') return;
    void opts.getToken().then((token) => {
      if (closed) return;
      if (!token) { scheduleReconnect(); return; }
      try {
        socket = new WebSocket(callSocketUrl(token));
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => { attempt = 0; opts.onConnected?.(); };
      socket.onmessage = (msg) => {
        const event = parseCallEvent(msg.data);
        if (event) opts.onEvent(event);
      };
      socket.onclose = () => { socket = null; scheduleReconnect(); };
      socket.onerror = () => { try { socket?.close(); } catch { /* closing */ } };
    }).catch(scheduleReconnect);
  }

  open();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      try { socket?.close(); } catch { /* closing */ }
      socket = null;
    },
  };
}

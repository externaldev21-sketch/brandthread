/**
 * Per-user realtime hints from the API (`/ws/user`, api-server
 * ws/userHub.ts). The server pushes a tiny "something changed" event the
 * moment a DM arrives / is read / someone types, or an Activity row lands;
 * screens refetch through their normal REST calls. Polls stay in place as
 * the safety net, so a dropped socket only ever means a slower update.
 *
 * One shared socket per app session: it opens when the first subscriber
 * arrives, reconnects with backoff, and closes shortly after the last one
 * leaves. No-op where there is no signed-in session.
 */
import { serviceSession } from '@/lib/serviceConfig';

export type UserEvent =
  | { type: 'conversation.updated'; conversationId: string; reason: 'message' | 'read' | 'typing' | 'accepted' | 'deleted' }
  | { type: 'activity.updated' }
  | { type: 'ready' };

type Listener = (event: UserEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let connecting = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let open = false;

const MAX_BACKOFF_MS = 30_000;

/** True while the realtime socket is connected (polls may slow down). */
export function isUserEventsConnected(): boolean {
  return open;
}

function scheduleReconnect(): void {
  if (listeners.size === 0 || retryTimer) return;
  attempts += 1;
  retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS));
}

async function connect(): Promise<void> {
  if (socket || connecting || listeners.size === 0 || typeof WebSocket === 'undefined') return;
  connecting = true;
  try {
    const session = await serviceSession();
    if (!session || !session.base) { scheduleReconnect(); return; }
    const url = `${session.base.replace(/^http/, 'ws')}/ws/user?token=${encodeURIComponent(session.token)}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }
    socket = ws;
    ws.onopen = () => { attempts = 0; open = true; };
    ws.onmessage = (e) => {
      let event: UserEvent;
      try { event = JSON.parse(String(e.data)) as UserEvent; } catch { return; }
      for (const fn of [...listeners]) { try { fn(event); } catch { /* one listener must not break another */ } }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket === ws) socket = null;
      open = false;
      scheduleReconnect();
    };
  } finally {
    connecting = false;
  }
}

function disconnect(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const s = socket;
  socket = null;
  open = false;
  if (s) { s.onopen = s.onmessage = s.onerror = s.onclose = null; try { s.close(); } catch { /* already closed */ } }
}

export function subscribeUserEvents(fn: Listener): () => void {
  listeners.add(fn);
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  void connect();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && !idleTimer) {
      // Brief grace so screen-to-screen navigation doesn't churn the socket.
      idleTimer = setTimeout(() => { idleTimer = null; if (listeners.size === 0) disconnect(); }, 15_000);
    }
  };
}

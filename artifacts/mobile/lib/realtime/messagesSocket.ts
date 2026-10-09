/**
 * One shared realtime socket per app session for messages, read receipts,
 * typing, orders and badge counts (api-server ws/messagesHub.ts, path
 * `/ws/messages`).
 *
 * The socket opens when the first screen subscribes, reconnects with capped
 * backoff, reconnects straight away when the app returns to the foreground or
 * the active account changes, and closes shortly after the last subscriber
 * leaves. Screens keep a slow REST poll that runs only while
 * `isRealtimeConnected()` is false, so a dropped socket is a slower update,
 * never a frozen one.
 *
 * Never connects signed out or in the signed-out dev previews — the hub is a
 * protected endpoint.
 */
import { getServiceToken, onServicesConfigured } from '@/lib/serviceConfig';

// Kept dependency-light on purpose: services (activityService) import this
// module, so react-native and the preview flags are required lazily and the
// API base is read the same way lib/api.ts reads it.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');

export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'pong' }
  | { type: 'message.created'; conversationId: string; message: Record<string, unknown> }
  | { type: 'message.read'; conversationId: string; readerId: string; readAt: string }
  | { type: 'typing'; conversationId: string; userId: string; typing: boolean }
  | { type: 'conversation.updated'; conversationId: string; reason: string }
  | { type: 'order.created'; orderId: string }
  | { type: 'order.updated'; orderId: string; status: string }
  | { type: 'badges.changed' };

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (connected: boolean) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();
let socket: WebSocket | null = null;
let connecting = false;
let connected = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let wired = false;

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const PING_MS = 25_000;
const IDLE_CLOSE_MS = 15_000;

/** Capped exponential backoff for reconnect attempt `n` (1-based). */
export function reconnectDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

/** ws(s):// URL for the hub on the given API base. */
export function messagesSocketUrl(apiBase: string, token: string): string {
  const base = apiBase.replace(/\/+$/, '').replace(/^http/, 'ws');
  return `${base}/ws/messages?token=${encodeURIComponent(token)}`;
}

/** Parses one frame; null for anything malformed or without a type. */
export function parseRealtimeEvent(raw: unknown): RealtimeEvent | null {
  try {
    const event = JSON.parse(String(raw)) as { type?: unknown };
    return event && typeof event.type === 'string' ? (event as RealtimeEvent) : null;
  } catch {
    return null;
  }
}

function setConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const fn of [...statusListeners]) { try { fn(next); } catch { /* ignore */ } }
}

/** True while the socket is open; polls use this to stand down. */
export function isRealtimeConnected(): boolean {
  return connected;
}

function previewMode(): boolean {
  try {
    const { isBuyerDevPreview, isSellerDevPreview } = require('../devPreview') as typeof import('../devPreview');
    return isBuyerDevPreview() || isSellerDevPreview();
  } catch {
    return false;
  }
}

function scheduleReconnect(): void {
  if (listeners.size === 0 || retryTimer) return;
  attempts += 1;
  retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, reconnectDelayMs(attempts));
}

function teardown(): void {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  const s = socket;
  socket = null;
  setConnected(false);
  if (s) {
    s.onopen = null; s.onmessage = null; s.onerror = null; s.onclose = null;
    try { s.close(); } catch { /* already closed */ }
  }
}

async function connect(): Promise<void> {
  if (socket || connecting || listeners.size === 0 || typeof WebSocket === 'undefined' || previewMode()) return;
  if (!API_BASE_URL) return;
  connecting = true;
  try {
    const token = await getServiceToken();
    if (listeners.size === 0) return;
    if (!token) { scheduleReconnect(); return; }
    let ws: WebSocket;
    try { ws = new WebSocket(messagesSocketUrl(API_BASE_URL, token)); } catch { scheduleReconnect(); return; }
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      attempts = 0;
      setConnected(true);
      pingTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* closing */ }
      }, PING_MS);
    };
    ws.onmessage = (e) => {
      const event = parseRealtimeEvent(e.data);
      if (!event) return;
      for (const fn of [...listeners]) { try { fn(event); } catch { /* one listener must not break another */ } }
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => {
      if (socket !== ws) return;
      teardown();
      scheduleReconnect();
    };
  } finally {
    connecting = false;
  }
}

function reconnectNow(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  attempts = 0;
  teardown();
  void connect();
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  // Account switch / sign-in / sign-out: the next socket must carry the new token.
  onServicesConfigured(() => { if (listeners.size > 0) reconnectNow(); });
  // Phones drop sockets in the background; come back connected.
  try {
    const { AppState } = require('react-native') as typeof import('react-native');
    AppState.addEventListener('change', (state) => {
      if (state === 'active' && listeners.size > 0 && !connected) reconnectNow();
    });
  } catch { /* AppState unavailable (tests) */ }
}

/** Receive every realtime event. Returns an unsubscribe function. */
export function subscribeRealtime(fn: Listener): () => void {
  wireOnce();
  listeners.add(fn);
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  void connect();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && !idleTimer) {
      // A short grace so screen-to-screen navigation doesn't churn the socket.
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (listeners.size === 0) {
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
          teardown();
        }
      }, IDLE_CLOSE_MS);
    }
  };
}

/** Follow connected/disconnected transitions (drives the polling fallback). */
export function subscribeRealtimeStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

/**
 * Per-user realtime channel for messages, read receipts, typing, orders and
 * badge counts: `/ws/messages?token=<clerk jwt>`.
 *
 * Same shape as the live and community hubs (one `ws` server on the existing
 * HTTP server's 'upgrade' event, same Clerk token check from ./auth), but the
 * "room" is a user: every app session a person has open gets the events
 * meant for them. Routes call `emitToUsers()` after their write commits; the
 * hub never reads the database itself, so permissions, blocks and mutes stay
 * in the REST routes that already own them.
 *
 * Events (server → client), JSON with a `type`:
 *   message.created   { conversationId, message }   — full message, as the REST list returns it
 *   message.read      { conversationId, readerId, readAt }
 *   typing            { conversationId, userId, typing }
 *   conversation.updated { conversationId, reason }  — reaction / accepted / deleted / …
 *   order.created     { orderId }                    — to the seller
 *   order.updated     { orderId, status, trackingStatus } — to buyer and seller
 *   badges.changed    {}                              — unread counts moved; refetch them
 *
 * Multi-instance: when REDIS_URL is set every emit is also published on a
 * Redis channel and each instance delivers to its own sockets. Without Redis
 * it is single-process like the other hubs. Clients keep a slow REST poll as
 * a fallback while the socket is down, so a missed event is a slower update,
 * never lost data.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Redis } from "ioredis";
import { verifyWsToken } from "./auth";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";

const WS_PATH = "/ws/messages";
const REDIS_CHANNEL = "bt:messages-hub";
const INSTANCE_ID = crypto.randomUUID();

export type MessagesHubEvent =
  | { type: "message.created"; conversationId: string; message: Record<string, unknown> }
  | { type: "message.read"; conversationId: string; readerId: string; readAt: string }
  | { type: "typing"; conversationId: string; userId: string; typing: boolean }
  | { type: "conversation.updated"; conversationId: string; reason: string }
  | { type: "order.created"; orderId: string }
  | { type: "order.updated"; orderId: string; status: string; trackingStatus?: string | null }
  | { type: "badges.changed" };

type UserSocket = WebSocket & { userId?: string; isAlive?: boolean };

const socketsByUser = new Map<string, Set<UserSocket>>();
let subscriber: Redis | null = null;

function deliverLocal(userIds: readonly string[], event: MessagesHubEvent): void {
  const data = JSON.stringify(event);
  for (const userId of userIds) {
    for (const socket of socketsByUser.get(userId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }
}

/**
 * Sends `event` to every open app session of these users. Never throws —
 * realtime is best-effort on top of a write that already succeeded.
 */
export function emitToUsers(userIds: Iterable<string | null | undefined>, event: MessagesHubEvent): void {
  try {
    const ids = [...new Set([...userIds].filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (ids.length === 0) return;
    deliverLocal(ids, event);
    const redis = getRedis();
    if (redis) {
      void redis.publish(REDIS_CHANNEL, JSON.stringify({ from: INSTANCE_ID, userIds: ids, event }))
        .catch((err: unknown) => logger.warn({ err }, "messages hub publish failed"));
    }
  } catch (err) {
    logger.warn({ err }, "messages hub emit failed");
  }
}

/**
 * Delivers to this instance's sockets only. For events every instance already
 * sees on its own (Postgres LISTEN/NOTIFY in lib/orderChangeListener.ts), so
 * the Redis fan-out doesn't deliver them twice.
 */
export function emitToUsersLocal(userIds: Iterable<string | null | undefined>, event: MessagesHubEvent): void {
  try {
    const ids = [...new Set([...userIds].filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (ids.length > 0) deliverLocal(ids, event);
  } catch (err) {
    logger.warn({ err }, "messages hub local emit failed");
  }
}

/** Open sockets for a user on this instance. */
export function messagesSocketCount(userId: string): number {
  return socketsByUser.get(userId)?.size ?? 0;
}

/** True when the user has the app open on this instance (used to skip redundant pushes). */
export function isUserConnected(userId: string): boolean {
  for (const socket of socketsByUser.get(userId) ?? []) {
    if (socket.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

function startRedisFanIn(): void {
  const redis = getRedis();
  if (!redis || subscriber) return;
  try {
    subscriber = redis.duplicate();
    void subscriber.subscribe(REDIS_CHANNEL).catch((err: unknown) => logger.warn({ err }, "messages hub subscribe failed"));
    subscriber.on("message", (_channel: string, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { from: string; userIds: string[]; event: MessagesHubEvent };
        if (msg.from !== INSTANCE_ID && Array.isArray(msg.userIds)) deliverLocal(msg.userIds, msg.event);
      } catch { /* malformed — ignore */ }
    });
  } catch (err) {
    logger.warn({ err }, "messages hub Redis fan-in unavailable; single-instance delivery only");
  }
}

export function attachMessagesWebSocket(
  httpServer: HttpServer,
  opts: { verifyToken?: (token: string | null | undefined) => Promise<string | null> } = {},
): WebSocketServer {
  const verify = opts.verifyToken ?? verifyWsToken;
  const wss = new WebSocketServer({ noServer: true });
  startRedisFanIn();

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    let url: URL;
    try { url = new URL(req.url ?? "", "http://internal"); } catch { return; }
    if (url.pathname !== WS_PATH) return; // not ours
    const token = url.searchParams.get("token");
    void (async () => {
      const userId = await verify(token);
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, userId));
    })().catch((err) => {
      logger.error({ err }, "Messages WebSocket upgrade failed unexpectedly");
      socket.destroy();
    });
  });

  wss.on("connection", (ws: UserSocket, _req: IncomingMessage, userId: string) => {
    ws.userId = userId;
    ws.isAlive = true;
    let set = socketsByUser.get(userId);
    if (!set) { set = new Set(); socketsByUser.set(userId, set); }
    set.add(ws);
    ws.on("pong", () => { ws.isAlive = true; });
    // Clients may send {type:"ping"} to keep proxies from idling the socket out.
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg?.type === "ping" && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "pong" }));
      } catch { /* ignore */ }
    });
    ws.on("close", () => {
      const current = socketsByUser.get(userId);
      current?.delete(ws);
      if (current && current.size === 0) socketsByUser.delete(userId);
    });
    ws.on("error", (err) => logger.warn({ err }, "Messages WebSocket error"));
    ws.send(JSON.stringify({ type: "ready" }));
  });

  const pingInterval = setInterval(() => {
    for (const set of socketsByUser.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }
  }, 30_000);
  pingInterval.unref();
  wss.on("close", () => clearInterval(pingInterval));
  return wss;
}

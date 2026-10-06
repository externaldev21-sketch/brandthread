/**
 * Per-user realtime channel: `/ws/user?token=<clerk jwt>`.
 *
 * DMs and Activity were poll-only (12–15s message polls, a 3s typing poll, a
 * 1.5s unread-count poll), so the other side of a buyer↔seller conversation
 * saw a new message, a read receipt or a typing indicator late, and the
 * Activity bell lagged. This channel pushes a small HINT the moment
 * something changes for a user; the app then refetches through the same
 * REST endpoints it already uses (so permissions, blocks, mutes and shape
 * stay in exactly one place — the hint itself carries no content).
 *
 * Events (server → client), JSON:
 *   { type: "conversation.updated", conversationId, reason: "message" | "read" | "typing" | "accepted" | "deleted" }
 *   { type: "activity.updated" }
 *
 * Multi-instance: when REDIS_URL is configured, every emit is also published
 * on a Redis channel and each instance delivers to its own local sockets.
 * Without Redis it is single-process (same as the live/community hubs), and
 * clients keep their existing polls as the safety net, so a missed hint is
 * only ever a slower update, never lost data.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type Redis from "ioredis";
import { verifyWsToken } from "./auth";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";

const WS_PATH = "/ws/user";
const REDIS_CHANNEL = "bt:user-events";
const INSTANCE_ID = crypto.randomUUID();

export type UserEvent =
  | { type: "conversation.updated"; conversationId: string; reason: "message" | "read" | "typing" | "accepted" | "deleted" }
  | { type: "activity.updated" };

type UserSocket = WebSocket & { userId?: string; isAlive?: boolean };

const socketsByUser = new Map<string, Set<UserSocket>>();
let subscriber: Redis | null = null;

function deliverLocal(userIds: string[], event: UserEvent): void {
  const data = JSON.stringify(event);
  for (const userId of userIds) {
    for (const socket of socketsByUser.get(userId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }
}

/** Push a change hint to every open app session of these users (all instances). */
export function emitToUsers(userIds: Iterable<string>, event: UserEvent): void {
  const ids = [...new Set([...userIds].filter(Boolean))];
  if (ids.length === 0) return;
  deliverLocal(ids, event);
  const redis = getRedis();
  if (redis) {
    void redis.publish(REDIS_CHANNEL, JSON.stringify({ from: INSTANCE_ID, userIds: ids, event }))
      .catch((err) => logger.warn({ err }, "user-events publish failed"));
  }
}

/** Open sockets for a user on THIS instance (tests / diagnostics). */
export function userSocketCount(userId: string): number {
  return socketsByUser.get(userId)?.size ?? 0;
}

function startRedisFanIn(): void {
  const redis = getRedis();
  if (!redis || subscriber) return;
  try {
    subscriber = redis.duplicate();
    void subscriber.subscribe(REDIS_CHANNEL).catch((err) => logger.warn({ err }, "user-events subscribe failed"));
    subscriber.on("message", (_channel: string, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { from: string; userIds: string[]; event: UserEvent };
        if (msg.from !== INSTANCE_ID) deliverLocal(msg.userIds, msg.event);
      } catch { /* malformed — ignore */ }
    });
  } catch (err) {
    logger.warn({ err }, "user-events Redis fan-in unavailable; single-instance delivery only");
  }
}

export function attachUserWebSocket(
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
      logger.error({ err }, "User WebSocket upgrade failed unexpectedly");
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
    ws.on("close", () => {
      const current = socketsByUser.get(userId);
      current?.delete(ws);
      if (current && current.size === 0) socketsByUser.delete(userId);
    });
    ws.on("error", (err) => logger.warn({ err }, "User WebSocket error"));
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

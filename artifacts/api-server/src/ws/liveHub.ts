/**
 * Live-stream WebSocket hub.
 *
 * One `ws` WebSocketServer attached to the SAME underlying HTTP server the
 * Express app already listens on (via the server's 'upgrade' event, see
 * attachLiveWebSocket) — not a second port. Clients connect to
 * `/ws/live?streamId=<id>&token=<clerk jwt>` and join a per-stream "room";
 * routes/live.ts broadcasts into a room on new comment / product-tag change,
 * and jobs/liveViewersPresence.ts broadcasts recomputed viewer counts.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { verifyWsToken } from "./auth";
import { logger } from "../lib/logger";
import { loadRestriction } from "../lib/liveModerationState";

const WS_PATH = "/ws/live";

type LiveSocket = WebSocket & { streamId?: string; userId?: string; isAlive?: boolean };

const rooms = new Map<string, Set<LiveSocket>>();

function roomFor(streamId: string): Set<LiveSocket> {
  let room = rooms.get(streamId);
  if (!room) {
    room = new Set();
    rooms.set(streamId, room);
  }
  return room;
}

function leaveRoom(ws: LiveSocket): void {
  if (!ws.streamId) return;
  const room = rooms.get(ws.streamId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(ws.streamId);
}

/** Broadcasts a JSON-serializable event to every socket subscribed to `streamId`. */
export function broadcastToRoom(streamId: string, payload: Record<string, unknown>): void {
  const room = rooms.get(streamId);
  if (!room || room.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of room) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

/** Closes every socket `userId` holds in `streamId`'s room (used when the host bans a viewer). */
export function disconnectUserFromRoom(streamId: string, userId: string): void {
  const room = rooms.get(streamId);
  if (!room) return;
  for (const socket of [...room]) {
    if (socket.userId === userId) {
      try { socket.close(4003, "removed"); } catch { /* ignore */ }
    }
  }
}

/** Stream ids that currently have at least one connected socket. */
export function streamIdsWithSockets(): string[] {
  return [...rooms.keys()];
}

async function upsertViewer(streamId: string, userId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO live_viewers (stream_id, user_id_or_session_id, last_seen)
    VALUES (${streamId}::uuid, ${userId}, now())
    ON CONFLICT (stream_id, user_id_or_session_id)
    DO UPDATE SET last_seen = now()
  `);
}

async function removeViewer(streamId: string, userId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM live_viewers
    WHERE stream_id = ${streamId}::uuid AND user_id_or_session_id = ${userId}
  `);
}

function originIsUpgradeForLivePath(req: IncomingMessage): URL | null {
  try {
    const url = new URL(req.url ?? "", "http://internal");
    if (url.pathname !== WS_PATH) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Attaches the live-stream WebSocket server to `httpServer`'s 'upgrade'
 * event. Any upgrade request whose path isn't `/ws/live` is left alone so
 * other upgrade handlers (if any are ever added) still work.
 */
export function attachLiveWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = originIsUpgradeForLivePath(req);
    if (!url) return; // not ours — let it pass through unhandled

    const streamId = url.searchParams.get("streamId");
    const token = url.searchParams.get("token");
    // seller-live.tsx connects with role=host to receive comment/viewer-count
    // broadcasts without counting itself as a viewer in the presence table —
    // the old code never counted the broadcaster as a viewer either.
    const isHost = url.searchParams.get("role") === "host";

    if (!streamId) {
      socket.destroy();
      return;
    }

    void verifyWsToken(token).then((userId) => {
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, { streamId, userId, isHost });
      });
    }).catch((err) => {
      logger.error({ err }, "Live WebSocket upgrade auth threw unexpectedly");
      socket.destroy();
    });
  });

  wss.on("connection", (ws: LiveSocket, _req: IncomingMessage, ctx: { streamId: string; userId: string; isHost: boolean }) => {
    ws.streamId = ctx.streamId;
    ws.userId = ctx.userId;
    ws.isAlive = true;
    roomFor(ctx.streamId).add(ws);

    // A viewer the host banned can't re-enter the room by reconnecting.
    // (Checked even for role=host: that flag is client-claimed, and a host can never be banned.)
    void loadRestriction(ctx.streamId, ctx.userId).then((kind) => {
      if (kind === "ban") {
        leaveRoom(ws);
        try { ws.close(4003, "removed"); } catch { /* ignore */ }
      }
    }).catch((err) => logger.warn({ err }, "live ws ban check failed"));

    if (!ctx.isHost) {
      void upsertViewer(ctx.streamId, ctx.userId).catch((err) =>
        logger.error({ err, streamId: ctx.streamId }, "live_viewers upsert on connect failed"),
      );
    }

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === "heartbeat" && ws.streamId && ws.userId && !ctx.isHost) {
        void upsertViewer(ws.streamId, ws.userId).catch((err) =>
          logger.error({ err, streamId: ws.streamId }, "live_viewers heartbeat upsert failed"),
        );
      }
    });

    ws.on("close", () => {
      leaveRoom(ws);
      if (ws.streamId && ws.userId && !ctx.isHost) {
        void removeViewer(ws.streamId, ws.userId).catch((err) =>
          logger.error({ err, streamId: ws.streamId }, "live_viewers removal on close failed"),
        );
      }
    });

    ws.on("error", (err) => {
      logger.warn({ err, streamId: ctx.streamId }, "Live WebSocket connection error");
    });
  });

  // Dead-connection reaper: a client that vanished without a clean close
  // (phone killed, network drop) never fires 'close'. Ping every 30s; any
  // socket that didn't pong since the last sweep is terminated, which does
  // fire 'close' and cleans up its room + live_viewers row.
  const pingInterval = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }
  }, 30_000);
  pingInterval.unref();

  return wss;
}

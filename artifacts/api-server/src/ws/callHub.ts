/**
 * 1:1 DM call signalling channel.
 *
 * Same shape as the live/community hubs (one `ws` server on the existing HTTP
 * server's 'upgrade' event), but rooms are users: the app keeps
 * `/ws/calls?token=<clerk jwt>` open while signed in, and every socket of a
 * user (phone + tablet, a reconnect overlapping the old socket) joins that
 * user's room.
 *
 * Events (server → client), JSON:
 *   { type: "call.incoming", call }   a call is ringing for this user
 *   { type: "call.updated",  call }   accepted / declined / cancelled / missed / ended
 * `call` is always serialized from the recipient's point of view.
 *
 * Single-process like the other hubs; clients also catch up with
 * GET /api/call/dm/incoming on (re)connect and push tap, so a missed socket
 * event never loses a call.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyWsToken } from "./auth";
import { logger } from "../lib/logger";

const WS_PATH = "/ws/calls";

type CallSocket = WebSocket & { userId?: string; isAlive?: boolean };

const rooms = new Map<string, Set<CallSocket>>();

function leaveRoom(ws: CallSocket): void {
  if (!ws.userId) return;
  const room = rooms.get(ws.userId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(ws.userId);
}

/** Send one event to every open socket of `userId`. Returns the number of sockets reached. */
export function sendCallEvent(userId: string, payload: Record<string, unknown>): number {
  const room = rooms.get(userId);
  if (!room || room.size === 0) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const socket of room) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
      sent += 1;
    }
  }
  return sent;
}

export function callSocketCount(userId: string): number {
  return rooms.get(userId)?.size ?? 0;
}

function parseUpgradeUrl(req: IncomingMessage): URL | null {
  try {
    const url = new URL(req.url ?? "", "http://internal");
    return url.pathname === WS_PATH ? url : null;
  } catch {
    return null;
  }
}

export function attachCallWebSocket(
  httpServer: HttpServer,
  opts: { verifyToken?: (token: string | null | undefined) => Promise<string | null> } = {},
): WebSocketServer {
  const verify = opts.verifyToken ?? verifyWsToken;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = parseUpgradeUrl(req);
    if (!url) return; // not ours
    const token = url.searchParams.get("token");

    void (async () => {
      const userId = await verify(token);
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, { userId });
      });
    })().catch((err) => {
      logger.error({ err }, "Call WebSocket upgrade failed unexpectedly");
      socket.destroy();
    });
  });

  wss.on("connection", (ws: CallSocket, _req: IncomingMessage, ctx: { userId: string }) => {
    ws.userId = ctx.userId;
    ws.isAlive = true;
    let room = rooms.get(ctx.userId);
    if (!room) { room = new Set(); rooms.set(ctx.userId, room); }
    room.add(ws);

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => leaveRoom(ws));
    ws.on("error", (err) => logger.warn({ err }, "Call WebSocket error"));
  });

  const pingInterval = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room) {
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

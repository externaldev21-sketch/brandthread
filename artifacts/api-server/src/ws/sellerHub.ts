/**
 * Seller-scoped WebSocket hub (`/ws/seller`).
 *
 * Same shape as ws/liveHub.ts: one `ws` server on the existing HTTP server's
 * 'upgrade' event, Clerk session JWT in the `token` query param (see
 * ws/auth.ts). Each socket joins the room of the store it is acting for: the
 * caller's own store, or, with `store=<team membership id>`, a store they
 * are an active team member of (the same selection X-Store-Context makes on
 * HTTP routes; an unknown/foreign membership id is refused).
 *
 * Today it carries one event, `order_city`, sent by routes/webhooks.ts after
 * a paid order commits, for the seller dashboard Live map. Payloads are city
 * level only: never order totals, names or addresses.
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { db, teamMembers } from "@workspace/db";
import { verifyWsToken } from "./auth";
import { logger } from "../lib/logger";

const WS_PATH = "/ws/seller";

type SellerSocket = WebSocket & { sellerId?: string; isAlive?: boolean };

const rooms = new Map<string, Set<SellerSocket>>();

function leaveRoom(ws: SellerSocket): void {
  if (!ws.sellerId) return;
  const room = rooms.get(ws.sellerId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(ws.sellerId);
}

/** Sends a JSON event to every socket currently open for `sellerId`'s store. */
export function broadcastToSeller(sellerId: string, payload: Record<string, unknown>): void {
  const room = rooms.get(sellerId);
  if (!room || room.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of room) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

/** Number of open sockets for a seller (tests / diagnostics). */
export function sellerSocketCount(sellerId: string): number {
  return rooms.get(sellerId)?.size ?? 0;
}

async function resolveStoreOwner(userId: string, membershipId: string | null): Promise<string | null> {
  if (!membershipId || membershipId === "own") return userId;
  const [row] = await db
    .select({ ownerId: teamMembers.ownerId })
    .from(teamMembers)
    .where(and(
      eq(teamMembers.id, membershipId),
      eq(teamMembers.memberClerkId, userId),
      eq(teamMembers.status, "active"),
    ))
    .limit(1);
  return row?.ownerId ?? null;
}

function upgradeUrl(req: IncomingMessage): URL | null {
  try {
    const url = new URL(req.url ?? "", "http://internal");
    return url.pathname === WS_PATH ? url : null;
  } catch {
    return null;
  }
}

export function attachSellerWebSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = upgradeUrl(req);
    if (!url) return; // another hub's path

    const token = url.searchParams.get("token");
    const store = url.searchParams.get("store");

    void verifyWsToken(token)
      .then(async (userId) => {
        const sellerId = userId ? await resolveStoreOwner(userId, store) : null;
        if (!userId || !sellerId) {
          socket.write(userId ? "HTTP/1.1 403 Forbidden\r\n\r\n" : "HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, { sellerId });
        });
      })
      .catch((err) => {
        logger.error({ err }, "Seller WebSocket upgrade auth threw unexpectedly");
        socket.destroy();
      });
  });

  wss.on("connection", (ws: SellerSocket, _req: IncomingMessage, ctx: { sellerId: string }) => {
    ws.sellerId = ctx.sellerId;
    ws.isAlive = true;
    let room = rooms.get(ctx.sellerId);
    if (!room) { room = new Set(); rooms.set(ctx.sellerId, room); }
    room.add(ws);

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => leaveRoom(ws));
    ws.on("error", (err) => logger.warn({ err }, "Seller WebSocket connection error"));
  });

  // Same dead-connection reaper as liveHub.ts.
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

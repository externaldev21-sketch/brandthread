/**
 * Community chat realtime channel.
 *
 * Same shape as the live-stream hub (one `ws` server on the existing HTTP
 * server's 'upgrade' event), but rooms are communities. The app subscribes at
 * `/ws/community?communityId=<id>&token=<clerk jwt>` only while a chat is
 * open. Membership is verified on connect — a non-member / banned user never
 * joins a room — and `kickFromCommunity` closes a member's sockets the moment
 * they leave, are removed or banned.
 *
 * Events (server → client), all JSON with a `type`:
 *   message.created   { message }            message.deleted  { messageId }
 *   reaction.updated  { messageId, reactions }
 *   member.removed    { userId }             community.deleted {}
 *
 * Nothing is fanned out per member in the database: a broadcast is one loop
 * over the sockets currently open in the room. (Single-process, like the live
 * hub; a multi-instance deploy would put a pub/sub adapter behind
 * `broadcastToCommunity` — clients also catch up via `after=<seq>` on
 * reconnect, so a missed event is never lost history.)
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db, communityMembers, communities } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { verifyWsToken } from "./auth";
import { logger } from "../lib/logger";
import { createRoomFanout } from "../lib/realtime/fanout";
import { getRealtimeBus } from "../lib/realtime/bus";
import { getRoomPresence } from "../lib/realtime/presence";

const WS_PATH = "/ws/community";

type CommunitySocket = WebSocket & { communityId?: string; userId?: string; isAlive?: boolean };

const rooms = new Map<string, Set<CommunitySocket>>();

function leaveRoom(ws: CommunitySocket): void {
  if (!ws.communityId) return;
  const room = rooms.get(ws.communityId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(ws.communityId);
}

export function broadcastToCommunity(communityId: string, payload: Record<string, unknown>): void {
  const room = rooms.get(communityId);
  communityFanout.publish("broadcast", communityId, payload); // other instances' sockets (lib/realtime)
  if (!room || room.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of room) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

/** Users with a chat open right now — they are reading live, so they don't need a push. */
export function connectedUserIds(communityId: string): Set<string> {
  const ids = new Set<string>();
  for (const s of rooms.get(communityId) ?? []) if (s.userId && s.readyState === WebSocket.OPEN) ids.add(s.userId);
  return ids;
}

export function communitySocketCount(communityId: string): number {
  return rooms.get(communityId)?.size ?? 0;
}

export function kickFromCommunity(communityId: string, userId: string): void {
  communityFanout.publish("kick", communityId, { userId });
  const room = rooms.get(communityId);
  if (!room) return;
  for (const s of [...room]) {
    if (s.userId === userId) {
      try { s.close(4403, "removed"); } catch { /* ignore */ }
      room.delete(s);
    }
  }
  if (room.size === 0) rooms.delete(communityId);
}

export function closeCommunityRoom(communityId: string): void {
  communityFanout.publish("close", communityId, {});
  const room = rooms.get(communityId);
  if (!room) return;
  for (const s of room) { try { s.close(4404, "deleted"); } catch { /* ignore */ } }
  rooms.delete(communityId);
}

function parseUpgradeUrl(req: IncomingMessage): URL | null {
  try {
    const url = new URL(req.url ?? "", "http://internal");
    return url.pathname === WS_PATH ? url : null;
  } catch {
    return null;
  }
}

async function isActiveMember(communityId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .innerJoin(communities, eq(communities.id, communityMembers.communityId))
    .where(and(
      eq(communityMembers.communityId, communityId),
      eq(communityMembers.userId, userId),
      isNull(communities.deletedAt),
    ))
    .limit(1);
  return !!row;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attachCommunityWebSocket(
  httpServer: HttpServer,
  opts: { verifyToken?: (token: string | null | undefined) => Promise<string | null> } = {},
): WebSocketServer {
  const verify = opts.verifyToken ?? verifyWsToken;
  const wss = new WebSocketServer({ noServer: true });
  communityFanout.start();

  httpServer.on("upgrade", (req, socket, head) => {
    const url = parseUpgradeUrl(req);
    if (!url) return; // not ours
    const communityId = url.searchParams.get("communityId");
    const token = url.searchParams.get("token");
    if (!communityId || !UUID_RE.test(communityId)) { socket.destroy(); return; }

    void (async () => {
      const userId = await verify(token);
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!(await isActiveMember(communityId, userId))) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, { communityId, userId });
      });
    })().catch((err) => {
      logger.error({ err }, "Community WebSocket upgrade failed unexpectedly");
      socket.destroy();
    });
  });

  wss.on("connection", (ws: CommunitySocket, _req: IncomingMessage, ctx: { communityId: string; userId: string }) => {
    ws.communityId = ctx.communityId;
    ws.userId = ctx.userId;
    ws.isAlive = true;
    let room = rooms.get(ctx.communityId);
    if (!room) { room = new Set(); rooms.set(ctx.communityId, room); }
    room.add(ws);
    communityPresence().join(ctx.communityId, ctx.userId);

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => leaveRoom(ws));
    ws.on("close", () => communityPresence().leave(ctx.communityId, ctx.userId));
    ws.on("error", (err) => logger.warn({ err, communityId: ctx.communityId }, "Community WebSocket error"));
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

/**
 * Cross-instance delivery and presence (BT-472, lib/realtime). A broadcast,
 * kick or room close on one instance reaches the sockets on every instance.
 */
const communityFanout = createRoomFanout({
  topic: "community",
  apply: {
    broadcast: (communityId, payload) => broadcastToCommunity(communityId, payload),
    kick: (communityId, payload) => kickFromCommunity(communityId, String(payload.userId ?? "")),
    close: (communityId) => closeCommunityRoom(communityId),
  },
});

function communityPresence() {
  return getRoomPresence("community", getRealtimeBus().instanceId);
}

/** Users with this chat open on ANY instance (falls back to this instance's view). */
export async function connectedUserIdsEverywhere(communityId: string): Promise<Set<string>> {
  const all = await communityPresence().members(communityId);
  for (const id of connectedUserIds(communityId)) all.add(id);
  return all;
}

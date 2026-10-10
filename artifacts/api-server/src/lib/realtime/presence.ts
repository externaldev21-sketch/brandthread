/**
 * Who has a realtime room open, across every API instance (BT-472).
 *
 * Each instance counts its own sockets per (room, user) and heartbeats them
 * into a shared store with a TTL, so a dead instance's entries expire on
 * their own:
 *   redis      hash `rt:presence:<scope>:<room>`, field `<user>|<instance>`,
 *              value = expiry (ms); the key itself also expires.
 *   postgres   table `realtime_presence` (migration 458), one row per
 *              (scope, room, user, instance) with `expires_at`.
 *   inprocess  nothing shared: this instance's sockets only (as before).
 * The backend follows the realtime bus (REALTIME_BUS / REDIS_URL / DATABASE_URL).
 *
 * Live-stream viewer counts do not use this: they already aggregate across
 * instances in `live_viewers` (heartbeat + 45 s freshness, see
 * jobs/liveViewersPresence.ts). This is for "is this person looking at the
 * chat right now" checks such as skipping a community push.
 *
 * Presence is best effort. A store error is logged once and the caller gets
 * this instance's own view, which is exactly the old behavior.
 */
import { pool } from "@workspace/db";
import { getRedis, noteRedisFailure } from "../redis";
import { logger } from "../logger";
import { resolveBusBackend, type BusBackend } from "./bus";

const HEARTBEAT_MS = Number(process.env.REALTIME_PRESENCE_HEARTBEAT_MS) || 30_000;
const TTL_MS = Number(process.env.REALTIME_PRESENCE_TTL_MS) || 90_000;
const READ_TIMEOUT_MS = 1_000;

export interface PresenceStore {
  upsert(scope: string, entries: Array<{ room: string; userId: string }>, instanceId: string, ttlMs: number): Promise<void>;
  remove(scope: string, room: string, userId: string, instanceId: string): Promise<void>;
  members(scope: string, room: string): Promise<Set<string>>;
}

export const postgresPresenceStore: PresenceStore = {
  async upsert(scope, entries, instanceId, ttlMs) {
    if (entries.length === 0) return;
    await pool.query(
      `INSERT INTO realtime_presence (scope, room_id, user_id, instance_id, expires_at)
       SELECT $1, r, u, $4, now() + ($5::int * interval '1 millisecond')
       FROM unnest($2::text[], $3::text[]) AS t(r, u)
       ON CONFLICT (scope, room_id, user_id, instance_id)
       DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [scope, entries.map((e) => e.room), entries.map((e) => e.userId), instanceId, ttlMs],
    );
  },
  async remove(scope, room, userId, instanceId) {
    await pool.query(
      `DELETE FROM realtime_presence
       WHERE scope = $1 AND room_id = $2 AND user_id = $3 AND instance_id = $4`,
      [scope, room, userId, instanceId],
    );
  },
  async members(scope, room) {
    const { rows } = await pool.query(
      `SELECT DISTINCT user_id FROM realtime_presence
       WHERE scope = $1 AND room_id = $2 AND expires_at > now()`,
      [scope, room],
    );
    return new Set(rows.map((r: { user_id: string }) => r.user_id));
  },
};

const redisKey = (scope: string, room: string) => `rt:presence:${scope}:${room}`;

export const redisPresenceStore: PresenceStore = {
  async upsert(scope, entries, instanceId, ttlMs) {
    const r = getRedis();
    if (!r || entries.length === 0) return;
    const expires = String(Date.now() + ttlMs);
    const multi = r.multi();
    for (const e of entries) {
      multi.hset(redisKey(scope, e.room), `${e.userId}|${instanceId}`, expires);
      multi.pexpire(redisKey(scope, e.room), ttlMs);
    }
    await multi.exec();
  },
  async remove(scope, room, userId, instanceId) {
    const r = getRedis();
    if (!r) return;
    await r.hdel(redisKey(scope, room), `${userId}|${instanceId}`);
  },
  async members(scope, room) {
    const r = getRedis();
    if (!r) return new Set();
    const all = await r.hgetall(redisKey(scope, room));
    const now = Date.now();
    const out = new Set<string>();
    for (const [field, expires] of Object.entries(all)) {
      if (Number(expires) > now) out.add(field.slice(0, field.lastIndexOf("|")));
    }
    return out;
  },
};

function storeFor(backend: BusBackend): PresenceStore | null {
  if (backend === "redis") return redisPresenceStore;
  if (backend === "postgres") return postgresPresenceStore;
  return null;
}

export interface RoomPresence {
  /** One call per socket that opens. */
  join(room: string, userId: string): void;
  /** One call per socket that closes. */
  leave(room: string, userId: string): void;
  /** This instance's users in `room`. */
  localMembers(room: string): Set<string>;
  /** Users in `room` on any instance (always includes `localMembers`). */
  members(room: string): Promise<Set<string>>;
  /** Writes every local entry now (the heartbeat does this on a timer). */
  heartbeat(): Promise<void>;
  stop(): void;
}

export function createRoomPresence(opts: {
  scope: string;
  instanceId: string;
  store: PresenceStore | null;
  heartbeatMs?: number;
  ttlMs?: number;
}): RoomPresence {
  const ttlMs = opts.ttlMs ?? TTL_MS;
  // room -> user -> open socket count on this instance
  const local = new Map<string, Map<string, number>>();
  let timer: NodeJS.Timeout | null = null;
  let warned = false;

  const warn = (err: unknown) => {
    if (opts.store === redisPresenceStore) noteRedisFailure(err);
    if (warned) return;
    warned = true;
    logger.warn({ err: err instanceof Error ? err.message : String(err), scope: opts.scope }, "realtime presence store unavailable; using this instance's view (further warnings suppressed)");
  };

  const entries = () => {
    const out: Array<{ room: string; userId: string }> = [];
    for (const [room, users] of local) for (const userId of users.keys()) out.push({ room, userId });
    return out;
  };

  const heartbeat = async () => {
    if (!opts.store) return;
    try {
      await opts.store.upsert(opts.scope, entries(), opts.instanceId, ttlMs);
      warned = false;
    } catch (err) {
      warn(err);
    }
  };

  const ensureTimer = () => {
    if (timer || !opts.store) return;
    timer = setInterval(() => { void heartbeat(); }, opts.heartbeatMs ?? HEARTBEAT_MS);
    timer.unref?.();
  };

  return {
    join(room, userId) {
      let users = local.get(room);
      if (!users) { users = new Map(); local.set(room, users); }
      const n = (users.get(userId) ?? 0) + 1;
      users.set(userId, n);
      if (n === 1 && opts.store) {
        ensureTimer();
        opts.store.upsert(opts.scope, [{ room, userId }], opts.instanceId, ttlMs).catch(warn);
      }
    },

    leave(room, userId) {
      const users = local.get(room);
      const n = users?.get(userId) ?? 0;
      if (!users || n === 0) return;
      if (n > 1) { users.set(userId, n - 1); return; }
      users.delete(userId);
      if (users.size === 0) local.delete(room);
      opts.store?.remove(opts.scope, room, userId, opts.instanceId).catch(warn);
    },

    localMembers(room) {
      return new Set(local.get(room)?.keys() ?? []);
    },

    async members(room) {
      const mine = new Set(local.get(room)?.keys() ?? []);
      if (!opts.store) return mine;
      try {
        const shared = await Promise.race([
          opts.store.members(opts.scope, room),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("presence read timed out")), READ_TIMEOUT_MS).unref?.()),
        ]);
        for (const id of shared) mine.add(id);
      } catch (err) {
        warn(err);
      }
      return mine;
    },

    heartbeat,

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

const registry = new Map<string, RoomPresence>();

/** The process-wide presence for `scope`, on the same backend as the bus. */
export function getRoomPresence(scope: string, instanceId: string): RoomPresence {
  let p = registry.get(scope);
  if (!p) {
    p = createRoomPresence({ scope, instanceId, store: storeFor(resolveBusBackend()) });
    registry.set(scope, p);
  }
  return p;
}

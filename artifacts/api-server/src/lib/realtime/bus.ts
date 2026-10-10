/**
 * Cross-instance pub/sub for WebSocket rooms (BT-472).
 *
 * The live and community hubs keep their sockets in process memory. With
 * more than one API instance, a broadcast on instance A has to reach the
 * sockets connected to instance B. Each hub publishes every broadcast here
 * and every instance delivers what it receives to ITS OWN sockets
 * (lib/realtime/fanout.ts does that wiring).
 *
 * Backends, picked by `resolveBusBackend`:
 *   redis      REDIS_URL set. Publishes on the shared lib/redis.ts client,
 *              subscribes on one dedicated connection.
 *   postgres   default when DATABASE_URL is set and Redis is not. NOTIFY on
 *              the app pool, LISTEN on one dedicated client. NOTIFY payloads
 *              are capped by Postgres at 8000 bytes, so a larger message is
 *              stored in `realtime_bus_payloads` (migration 458) and only its
 *              id is notified.
 *   inprocess  tests and single-process dev. Every bus created in the same
 *              process shares one in-memory network.
 *
 * Override with REALTIME_BUS=redis|postgres|inprocess (inprocess also accepts
 * "off"). Delivery is best effort, like the hubs themselves: clients already
 * catch up over HTTP on reconnect (community `after=<seq>`, live comments).
 *
 * Every message carries the sender's instance id and a message id. A bus
 * never hands a subscriber its own messages (the sender already delivered
 * locally) and drops a message id it has already seen, so a socket gets each
 * event exactly once.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import pg from "pg";
import { Redis } from "ioredis";
import { getRedis, noteRedisFailure } from "../redis";
import { logger } from "../logger";

export type BusBackend = "redis" | "postgres" | "inprocess";

export type BusMeta = { instanceId: string; messageId: string };
export type BusHandler = (topic: string, data: unknown, meta: BusMeta) => void;

export interface RealtimeBus {
  readonly backend: BusBackend;
  readonly instanceId: string;
  /** Fire and forget. Never throws; failures are logged. */
  publish(topic: string, data: unknown): void;
  /** Receives messages published by OTHER instances. Returns an unsubscribe. */
  subscribe(handler: BusHandler): () => void;
  /** Resolves once the subscription is live (tests, startup logs). */
  ready(): Promise<void>;
  status(): "ok" | "connecting" | "down";
  close(): Promise<void>;
}

/** Postgres refuses NOTIFY payloads of 8000 bytes or more. */
export const PG_NOTIFY_MAX_BYTES = 8000;
export const PG_CHANNEL = "bt_realtime";
export const REDIS_CHANNEL = "bt:realtime";

type Envelope = { v: 1; i: string; m: string; t: string; d?: unknown; ref?: string };

type Env = Record<string, string | undefined>;

export function resolveBusBackend(env: Env = process.env): BusBackend {
  const raw = (env.REALTIME_BUS ?? "").trim().toLowerCase();
  if (raw === "redis" && env.REDIS_URL) return "redis";
  if (raw === "postgres" && (env.REALTIME_DATABASE_URL || env.DATABASE_URL)) return "postgres";
  if (raw === "inprocess" || raw === "off") return "inprocess";
  if (env.REDIS_URL) return "redis";
  // Test runs keep everything in process unless a test asks for a backend.
  if (env.NODE_ENV === "test" || env.VITEST) return "inprocess";
  if (env.DATABASE_URL) return "postgres";
  return "inprocess";
}

/**
 * LISTEN needs a real session, which a transaction-mode pooler (PgBouncer,
 * Neon `-pooler` hosts) does not give. REALTIME_DATABASE_URL wins; otherwise a
 * Neon pooled host is turned into its direct host by dropping `-pooler`.
 */
export function resolveListenUrl(env: Env = process.env): string | null {
  const explicit = env.REALTIME_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("-pooler.")) {
      parsed.hostname = parsed.hostname.replace("-pooler.", ".");
      return parsed.toString();
    }
  } catch {
    /* not a URL we can rewrite; use as is */
  }
  return url;
}

/** Remembers recent message ids so a redelivered message is dropped. */
class SeenIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 10_000) {}
  /** True when the id is new. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}

abstract class BaseBus implements RealtimeBus {
  abstract readonly backend: BusBackend;
  readonly instanceId: string;
  private readonly handlers = new Set<BusHandler>();
  private readonly seen = new SeenIds();

  constructor(instanceId?: string) {
    this.instanceId = instanceId ?? randomUUID();
  }

  protected envelope(topic: string, data: unknown): Envelope {
    return { v: 1, i: this.instanceId, m: randomUUID(), t: topic, d: data };
  }

  /** Called by the backend for every raw message it receives. */
  protected receive(env: Envelope): void {
    if (!env || env.v !== 1 || typeof env.m !== "string" || typeof env.t !== "string") return;
    if (env.i === this.instanceId) return;
    if (!this.seen.add(env.m)) return;
    for (const handler of this.handlers) {
      try {
        handler(env.t, env.d, { instanceId: env.i, messageId: env.m });
      } catch (err) {
        logger.warn({ err, topic: env.t }, "realtime bus handler threw");
      }
    }
  }

  subscribe(handler: BusHandler): () => void {
    this.handlers.add(handler);
    this.onFirstSubscribe();
    return () => { this.handlers.delete(handler); };
  }

  protected onFirstSubscribe(): void {}
  abstract publish(topic: string, data: unknown): void;
  abstract ready(): Promise<void>;
  abstract status(): "ok" | "connecting" | "down";
  abstract close(): Promise<void>;
}

// ─── In-process ──────────────────────────────────────────────────────────────

// Kept on globalThis so every copy of this module in one process (tests that
// load two hubs with vi.resetModules) shares one network.
const NETWORK_KEY = Symbol.for("brandthread.realtime.inprocess");
const defaultNetwork: EventEmitter =
  ((globalThis as Record<symbol, unknown>)[NETWORK_KEY] as EventEmitter | undefined) ??
  ((globalThis as Record<symbol, unknown>)[NETWORK_KEY] = new EventEmitter().setMaxListeners(0)) as EventEmitter;

export class InProcessBus extends BaseBus {
  readonly backend = "inprocess" as const;
  private readonly network: EventEmitter;
  private readonly listener = (env: Envelope) => this.receive(env);
  private attached = false;

  constructor(opts: { instanceId?: string; network?: EventEmitter } = {}) {
    super(opts.instanceId);
    this.network = opts.network ?? defaultNetwork;
  }

  protected override onFirstSubscribe(): void {
    if (this.attached) return;
    this.attached = true;
    this.network.on("message", this.listener);
  }

  publish(topic: string, data: unknown): void {
    const env = this.envelope(topic, data);
    // Async like a real network, so a publisher never re-enters itself.
    queueMicrotask(() => this.network.emit("message", env));
  }

  async ready(): Promise<void> {}
  status(): "ok" { return "ok"; }
  async close(): Promise<void> {
    this.network.off("message", this.listener);
    this.attached = false;
  }
}

// ─── Postgres LISTEN/NOTIFY ──────────────────────────────────────────────────

/** The subset of pg.Pool used for NOTIFY (the app pool by default). */
export interface QueryPool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export class PostgresBus extends BaseBus {
  readonly backend = "postgres" as const;
  private client: pg.Client | null = null;
  private state: "idle" | "connecting" | "ok" | "down" = "idle";
  private closed = false;
  private retryMs = 1_000;
  private retryTimer: NodeJS.Timeout | null = null;
  private readyWaiters: Array<() => void> = [];
  private queue: Array<{ topic: string; data: unknown }> = [];
  private flushing = false;
  private lastPayloadSweep = 0;
  private droppedWarned = false;

  constructor(private readonly opts: {
    listenUrl: string;
    pool: () => QueryPool;
    instanceId?: string;
    channel?: string;
    maxQueue?: number;
  }) {
    super(opts.instanceId);
  }

  private get channel(): string { return this.opts.channel ?? PG_CHANNEL; }

  protected override onFirstSubscribe(): void {
    if (this.state === "idle") void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.state = "connecting";
    const client = new pg.Client({ connectionString: this.opts.listenUrl });
    this.client = client;
    client.on("notification", (msg) => {
      if (msg.channel !== this.channel || !msg.payload) return;
      void this.handleNotification(msg.payload);
    });
    const fail = (err: unknown) => {
      if (this.client !== client) return;
      this.client = null;
      this.state = "down";
      client.removeAllListeners("notification");
      client.end().catch(() => {});
      if (this.closed) return;
      logger.warn({ err: err instanceof Error ? err.message : String(err), retryMs: this.retryMs }, "realtime bus LISTEN connection lost; reconnecting");
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, this.retryMs);
      this.retryTimer.unref?.();
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    };
    client.on("error", fail);
    client.on("end", () => fail(new Error("connection ended")));
    try {
      await client.connect();
      await client.query(`LISTEN ${this.channel}`);
      if (this.client !== client) return;
      this.state = "ok";
      this.retryMs = 1_000;
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      for (const w of waiters) w();
    } catch (err) {
      fail(err);
    }
  }

  private async handleNotification(raw: string): Promise<void> {
    let env: Envelope;
    try { env = JSON.parse(raw) as Envelope; } catch { return; }
    if (env.i === this.instanceId) return;
    if (env.ref && env.d === undefined) {
      try {
        const { rows } = await this.opts.pool().query(
          "SELECT body FROM realtime_bus_payloads WHERE id = $1::uuid",
          [env.ref],
        );
        if (!rows[0]) return;
        env = { ...env, d: JSON.parse(String(rows[0].body)) };
      } catch (err) {
        logger.warn({ err }, "realtime bus could not load a large payload");
        return;
      }
    }
    this.receive(env);
  }

  publish(topic: string, data: unknown): void {
    if (this.closed) return;
    const max = this.opts.maxQueue ?? 5_000;
    if (this.queue.length >= max) {
      if (!this.droppedWarned) {
        this.droppedWarned = true;
        logger.warn({ max }, "realtime bus publish queue full; dropping cross-instance events");
      }
      return;
    }
    this.queue.push({ topic, data });
    if (!this.flushing) void this.flush();
  }

  /**
   * Sends queued messages in order, up to 100 per round trip. One query at a
   * time keeps events from one instance in publish order.
   */
  private async flush(): Promise<void> {
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, 100);
        const payloads: string[] = [];
        for (const item of batch) {
          try {
            payloads.push(await this.encode(item.topic, item.data));
          } catch (err) {
            logger.warn({ err, topic: item.topic }, "realtime bus could not encode a message");
          }
        }
        if (payloads.length === 0) continue;
        try {
          await this.opts.pool().query(
            "SELECT pg_notify($1, p) FROM unnest($2::text[]) WITH ORDINALITY AS t(p, n)",
            [this.channel, payloads],
          );
          this.droppedWarned = false;
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), count: payloads.length }, "realtime bus NOTIFY failed; events reach this instance's sockets only");
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async encode(topic: string, data: unknown): Promise<string> {
    const env = this.envelope(topic, data);
    const json = JSON.stringify(env);
    if (Buffer.byteLength(json, "utf8") < PG_NOTIFY_MAX_BYTES) return json;
    const { rows } = await this.opts.pool().query(
      "INSERT INTO realtime_bus_payloads (body) VALUES ($1) RETURNING id",
      [JSON.stringify(data ?? null)],
    );
    this.sweepPayloads();
    return JSON.stringify({ v: 1, i: env.i, m: env.m, t: env.t, ref: String(rows[0].id) } satisfies Envelope);
  }

  /** Large payloads are only needed for a few seconds. */
  private sweepPayloads(): void {
    const now = Date.now();
    if (now - this.lastPayloadSweep < 60_000) return;
    this.lastPayloadSweep = now;
    this.opts.pool()
      .query("DELETE FROM realtime_bus_payloads WHERE created_at < now() - interval '10 minutes'")
      .catch(() => { this.lastPayloadSweep = 0; });
  }

  ready(): Promise<void> {
    if (this.state === "ok") return Promise.resolve();
    if (this.state === "idle") void this.connect();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  status(): "ok" | "connecting" | "down" {
    if (this.state === "ok") return "ok";
    return this.state === "down" ? "down" : "connecting";
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = null;
    this.state = "idle";
    if (client) {
      client.removeAllListeners();
      client.on("error", () => {});
      await client.end().catch(() => {});
    }
  }
}

// ─── Redis pub/sub ───────────────────────────────────────────────────────────

export class RedisBus extends BaseBus {
  readonly backend = "redis" as const;
  private sub: Redis | null = null;
  private state: "idle" | "connecting" | "ok" | "down" = "idle";
  private readyWaiters: Array<() => void> = [];

  constructor(private readonly opts: {
    url: string;
    publisher?: () => Redis | null;
    instanceId?: string;
    channel?: string;
  }) {
    super(opts.instanceId);
  }

  private get channel(): string { return this.opts.channel ?? REDIS_CHANNEL; }

  protected override onFirstSubscribe(): void {
    if (this.state === "idle") this.connect();
  }

  private connect(): void {
    this.state = "connecting";
    // A subscriber connection can't run other commands, so it is its own
    // client. ioredis re-subscribes by itself after a reconnect.
    const sub = new Redis(this.opts.url, {
      connectTimeout: 5_000,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    this.sub = sub;
    sub.on("message", (channel: string, raw: string) => {
      if (channel !== this.channel) return;
      try { this.receive(JSON.parse(raw) as Envelope); } catch { /* ignore malformed */ }
    });
    sub.on("ready", () => {
      // "ready" fires again after each reconnect; ioredis re-subscribes itself.
      void sub.subscribe(this.channel).then(() => {
        this.state = "ok";
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w();
      }).catch(() => { this.state = "down"; });
    });
    sub.on("error", (err: Error) => {
      this.state = "down";
      logger.warn({ err: err.message }, "realtime bus Redis subscriber error");
    });
    sub.on("end", () => { if (this.sub === sub) this.state = "down"; });
  }

  publish(topic: string, data: unknown): void {
    const r = (this.opts.publisher ?? getRedis)();
    if (!r) return; // Redis breaker open: local delivery still happened
    r.publish(this.channel, JSON.stringify(this.envelope(topic, data))).catch((err: unknown) => {
      noteRedisFailure(err);
    });
  }

  ready(): Promise<void> {
    if (this.state === "ok") return Promise.resolve();
    if (this.state === "idle") this.connect();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  status(): "ok" | "connecting" | "down" {
    if (this.state === "ok") return "ok";
    return this.state === "down" ? "down" : "connecting";
  }

  async close(): Promise<void> {
    const sub = this.sub;
    this.sub = null;
    this.state = "idle";
    if (sub) await sub.quit().catch(() => sub.disconnect());
  }
}

// ─── Process singleton ───────────────────────────────────────────────────────

let singleton: RealtimeBus | null = null;
let appPool: QueryPool | null = null;

async function loadAppPool(): Promise<QueryPool> {
  const mod = await import("@workspace/db");
  return mod.pool as unknown as QueryPool;
}

/** Lazily resolves the app pool so importing this module never opens a connection. */
function lazyAppPool(): () => QueryPool {
  return () => {
    if (appPool) return appPool;
    // Proxy that waits for the dynamic import on first use.
    const pending = loadAppPool().then((p) => { appPool = p; return p; });
    return { query: (text, values) => pending.then((p) => p.query(text, values)) };
  };
}

export function createRealtimeBus(env: Env = process.env, opts: { instanceId?: string; pool?: () => QueryPool } = {}): RealtimeBus {
  const backend = resolveBusBackend(env);
  if (backend === "redis") {
    return new RedisBus({ url: env.REDIS_URL!, instanceId: opts.instanceId });
  }
  if (backend === "postgres") {
    const listenUrl = resolveListenUrl(env);
    if (listenUrl) {
      return new PostgresBus({ listenUrl, pool: opts.pool ?? lazyAppPool(), instanceId: opts.instanceId });
    }
  }
  return new InProcessBus({ instanceId: opts.instanceId });
}

/** The bus every hub in this process shares. Created on first use. */
export function getRealtimeBus(): RealtimeBus {
  if (!singleton) {
    singleton = createRealtimeBus();
    logger.info({ backend: singleton.backend, instanceId: singleton.instanceId }, "realtime bus selected");
  }
  return singleton;
}

/** For /healthz/ready (informational) and shutdown. */
export function realtimeBusStatus(): { backend: BusBackend; status: string } | null {
  return singleton ? { backend: singleton.backend, status: singleton.status() } : null;
}

export async function closeRealtimeBus(): Promise<void> {
  const bus = singleton;
  singleton = null;
  if (bus) await bus.close();
}

/**
 * Shared scheduler for in-process background jobs.
 *
 * Every API replica starts the same set of interval jobs. Without
 * coordination each replica runs each job concurrently, so sweeps, payouts,
 * reminders and notifications would race each other. This runner wraps
 * every tick with:
 *
 *  1. An in-process overlap guard: a tick that fires while the previous run of
 *     the same job is still going is skipped (no pile-up of slow runs).
 *  2. A Postgres advisory lock so only one replica runs a given job at a time.
 *     The tick opens a transaction on a connection from a small DEDICATED pool
 *     (never the app pool, so a long job doesn't eat request capacity) and
 *     takes `pg_try_advisory_xact_lock(hashtext('job:<name>'))`. Replicas that
 *     don't get it skip the tick. The transaction stays open (idle, holding no
 *     snapshot or row locks) while the job runs on the normal app pool, and
 *     ends in `finally`, which releases the lock. A transaction-scoped lock is
 *     used rather than a session lock so this also works when DATABASE_URL is
 *     a transaction-mode pooler (PgBouncer, Neon/Supabase pooled URLs — see
 *     docs/scale/DATABASE.md), where a session lock could be taken on one
 *     server connection and leak forever. If the lock connection dies,
 *     Postgres ends the transaction and frees the lock.
 *  3. Error logging: a failing tick is logged with `{ err, job }` at error
 *     level (lib/monitoring forwards that to Sentry) and never stops the
 *     interval.
 *
 * Kill switches (jobs run by default):
 *   BACKGROUND_JOBS_ENABLED=false   disables every scheduled job on this process
 *   DISABLED_JOBS=a,b               disables the named jobs only
 * Tuning:
 *   JOB_LOCK_POOL_MAX               lock connections per process (default 5)
 */
import pg from "pg";
import { logger as defaultLogger } from "../lib/logger";

export type JobResult = "ran" | "failed" | "skipped_overlap" | "skipped_locked" | "skipped_lock_error";

export interface ScheduleOptions {
  intervalMs: number;
  /** Delay before the first run. Omitted = first run after `intervalMs`. 0 = run right away. */
  initialDelayMs?: number;
  /**
   * false = no cross-replica lock (overlap guard + error logging only). Only
   * for jobs whose effect is per-process, e.g. broadcasting to this replica's
   * own WebSocket clients.
   */
  distributed?: boolean;
}

export interface ScheduledJob {
  stop(): void;
}

type Log = Pick<typeof defaultLogger, "info" | "warn" | "error" | "debug">;

/** A checked-out lock connection (the subset of pg.PoolClient the runner uses). */
export interface LockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  /** Pass an error to discard the connection instead of returning it to the pool. */
  release(err?: Error | boolean): void;
}

export interface LockPool {
  connect(): Promise<LockClient>;
  end(): Promise<void>;
}

export interface JobRunnerOptions {
  /** Dedicated pool for lock transactions. Defaults to a small pg.Pool on DATABASE_URL, created lazily. */
  pool?: LockPool;
  log?: Log;
  env?: NodeJS.ProcessEnv;
}

const OFF_VALUES = new Set(["0", "false", "off", "no"]);

export function jobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BACKGROUND_JOBS_ENABLED?.trim().toLowerCase();
  return !raw || !OFF_VALUES.has(raw);
}

export function disabledJobs(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.DISABLED_JOBS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

function createDefaultPool(env: NodeJS.ProcessEnv, log: Log): LockPool {
  const max = Number(env.JOB_LOCK_POOL_MAX);
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: Number.isInteger(max) && max > 0 ? max : 5,
    // Bounds both opening a connection and waiting for a free one.
    connectionTimeoutMillis: 30_000,
    idleTimeoutMillis: 60_000,
    keepAlive: true,
    application_name: "api-job-locks",
  });
  pool.on("error", (err) => log.warn({ err, job: "runner" }, "Idle job lock connection error"));
  return pool as unknown as LockPool;
}

export function createJobRunner(opts: JobRunnerOptions = {}) {
  const log = opts.log ?? defaultLogger;
  const env = opts.env ?? process.env;
  let pool: LockPool | null = opts.pool ?? null;
  const getPool = () => (pool ??= createDefaultPool(env, log));
  const inFlight = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();

  /** Opens a transaction and tries the job's lock. Returns the client holding it, or null when another instance has it. */
  async function acquire(name: string): Promise<LockClient | null> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      // The transaction sits idle while the job runs; don't let a server-wide
      // idle-in-transaction timeout end it (and drop the lock) mid-job.
      await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
      const res = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", [`job:${name}`]);
      if (res.rows[0]?.locked === true) return client;
      await client.query("ROLLBACK");
      client.release();
      return null;
    } catch (err) {
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }

  async function releaseLock(name: string, client: LockClient): Promise<void> {
    try {
      await client.query("COMMIT");
      client.release();
    } catch (err) {
      // Discarding the connection ends the transaction server-side, which frees the lock.
      log.warn({ err, job: name }, "Background job lock release failed; discarding lock connection");
      client.release(err instanceof Error ? err : true);
    }
  }

  /** Runs one tick of `name` under the overlap guard and (by default) the cross-instance lock. */
  async function runOnce(
    name: string,
    fn: () => unknown,
    { distributed = true }: { distributed?: boolean } = {},
  ): Promise<JobResult> {
    if (inFlight.has(name)) {
      log.debug({ job: name }, "Background job still running; tick skipped");
      return "skipped_overlap";
    }
    inFlight.add(name);
    try {
      let lock: LockClient | null = null;
      if (distributed) {
        try {
          lock = await acquire(name);
        } catch (err) {
          // Fail closed: without the lock we can't know no other replica is
          // running it. The next tick retries. Warn, not error: during a DB
          // outage every job would otherwise page on every tick.
          log.warn({ err, job: name }, "Background job lock unavailable; tick skipped");
          return "skipped_lock_error";
        }
        if (!lock) {
          log.debug({ job: name }, "Background job running on another instance; tick skipped");
          return "skipped_locked";
        }
      }

      const started = Date.now();
      try {
        await fn();
        log.debug({ job: name, durationMs: Date.now() - started }, "Background job run finished");
        return "ran";
      } catch (err) {
        log.error({ err, job: name, durationMs: Date.now() - started }, "Background job failed");
        return "failed";
      } finally {
        if (lock) await releaseLock(name, lock);
      }
    } finally {
      inFlight.delete(name);
    }
  }

  /** Schedules `fn` every `intervalMs` through `runOnce`. A tick never throws. */
  function schedule(name: string, fn: () => unknown, options: ScheduleOptions): ScheduledJob {
    const { intervalMs, initialDelayMs, distributed = true } = options;
    if (!jobsEnabled(env) || disabledJobs(env).has(name)) {
      log.warn({ job: name }, "Background job disabled by env; not scheduled");
      return { stop() {} };
    }
    const tick = () => { void runOnce(name, fn, { distributed }).catch(() => {}); };
    const own: NodeJS.Timeout[] = [];
    if (initialDelayMs !== undefined) own.push(setTimeout(tick, initialDelayMs));
    own.push(setInterval(tick, intervalMs));
    for (const t of own) { t.unref?.(); timers.add(t); }
    log.info({ job: name, intervalMs, initialDelayMs, distributed }, "Background job scheduled");
    return {
      stop() {
        for (const t of own) { clearTimeout(t); clearInterval(t); timers.delete(t); }
      },
    };
  }

  /** Stops all timers and closes the lock pool (shutdown / tests). */
  async function close(): Promise<void> {
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    timers.clear();
    const p = pool;
    pool = opts.pool ?? null;
    // Don't let a still-running job hold up shutdown: pool.end() waits for
    // checked-out clients. Exiting drops the connection, which frees the lock.
    if (p) {
      await Promise.race([
        p.end().catch(() => {}),
        new Promise<void>((resolve) => { setTimeout(resolve, 2_000).unref?.(); }),
      ]);
    }
  }

  return { runOnce, schedule, close, isRunning: (name: string) => inFlight.has(name) };
}

export type JobRunner = ReturnType<typeof createJobRunner>;

/** Process-wide runner used by every start*Job function. */
export const jobRunner: JobRunner = createJobRunner();

export function scheduleJob(name: string, fn: () => unknown, options: ScheduleOptions): ScheduledJob {
  return jobRunner.schedule(name, fn, options);
}

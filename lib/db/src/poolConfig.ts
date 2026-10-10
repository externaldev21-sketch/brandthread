import type { PoolConfig } from "pg";

type Env = Record<string, string | undefined>;

const OFF = new Set(["0", "off", "false", "none"]);

/** undefined = not set, null = explicitly off ("0" / "off"), number = value. */
function setting(value: string | undefined): number | null | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (OFF.has(value.trim().toLowerCase())) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Production defaults (BT-474). A single slow query or a transaction left
 * open used to be able to hold connections forever and queue every other
 * request behind it. Each value is overridable by its env var; "0" or "off"
 * turns a timeout off.
 */
export const PRODUCTION_POOL_DEFAULTS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  // Long enough for a transaction that waits on Stripe or another API,
  // short enough that a leaked transaction cannot hold locks for minutes.
  idle_in_transaction_session_timeout: 60_000,
} as const;

/** Defaults apply in production, or anywhere with DB_POOL_DEFAULTS=on. */
export function poolDefaultsEnabled(env: Env = process.env): boolean {
  const flag = env.DB_POOL_DEFAULTS?.trim().toLowerCase();
  if (flag) return !OFF.has(flag);
  return env.NODE_ENV === "production";
}

/**
 * Pool settings from env.
 *
 *  DB_POOL_MAX                  max connections per API instance (default 10). Size so that
 *                               instances x DB_POOL_MAX stays under the pooler/DB limit.
 *  DB_POOL_IDLE_MS              close idle connections after this long (default 30 s)
 *  DB_CONNECT_TIMEOUT_MS        fail fast instead of queueing forever for a connection (default 10 s)
 *  DB_STATEMENT_TIMEOUT_MS      server-side cap on any single statement (default 15 s)
 *  DB_IDLE_IN_TX_TIMEOUT_MS     server-side cap on a transaction left open and idle (default 60 s)
 *  DB_POOL_DEFAULTS             on/off: force the defaults on or off (default: on in production)
 *
 * Outside production, with none of these set, the result is just
 * `{ connectionString }` (pg defaults), as before.
 */
export function buildPoolConfig(connectionString: string, env: Env = process.env): PoolConfig {
  const config: PoolConfig = { connectionString };
  const defaults = poolDefaultsEnabled(env) ? PRODUCTION_POOL_DEFAULTS : null;
  const pick = (raw: string | undefined, fallback: number | undefined): number | undefined => {
    const v = setting(raw);
    if (v === null) return undefined;
    return v ?? fallback;
  };
  const max = pick(env.DB_POOL_MAX, defaults?.max);
  const idle = pick(env.DB_POOL_IDLE_MS, defaults?.idleTimeoutMillis);
  const connect = pick(env.DB_CONNECT_TIMEOUT_MS, defaults?.connectionTimeoutMillis);
  const statement = pick(env.DB_STATEMENT_TIMEOUT_MS, defaults?.statement_timeout);
  const idleInTx = pick(env.DB_IDLE_IN_TX_TIMEOUT_MS, defaults?.idle_in_transaction_session_timeout);
  if (max) config.max = max;
  if (idle) config.idleTimeoutMillis = idle;
  if (connect) config.connectionTimeoutMillis = connect;
  if (statement) config.statement_timeout = statement;
  if (idleInTx) config.idle_in_transaction_session_timeout = idleInTx;
  return config;
}

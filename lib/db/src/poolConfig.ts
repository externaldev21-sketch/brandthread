import type { PoolConfig } from "pg";

type Env = Record<string, string | undefined>;

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Pool settings from env. With none of these set the result is just
 * `{ connectionString }`, i.e. exactly the previous behavior (pg defaults:
 * 10 connections, no timeouts), so nothing changes until Dev opts in.
 *
 *  DB_POOL_MAX                  max connections per API instance. Size so that
 *                               instances x DB_POOL_MAX stays under the pooler/DB limit.
 *  DB_POOL_IDLE_MS              close idle connections after this long
 *  DB_CONNECT_TIMEOUT_MS        fail fast instead of queueing forever for a connection
 *  DB_STATEMENT_TIMEOUT_MS      server-side cap on any single statement
 *  DB_IDLE_IN_TX_TIMEOUT_MS     server-side cap on a transaction left open and idle
 */
export function buildPoolConfig(connectionString: string, env: Env = process.env): PoolConfig {
  const config: PoolConfig = { connectionString };
  const max = positiveInt(env.DB_POOL_MAX);
  const idle = positiveInt(env.DB_POOL_IDLE_MS);
  const connect = positiveInt(env.DB_CONNECT_TIMEOUT_MS);
  const statement = positiveInt(env.DB_STATEMENT_TIMEOUT_MS);
  const idleInTx = positiveInt(env.DB_IDLE_IN_TX_TIMEOUT_MS);
  if (max) config.max = max;
  if (idle) config.idleTimeoutMillis = idle;
  if (connect) config.connectionTimeoutMillis = connect;
  if (statement) config.statement_timeout = statement;
  if (idleInTx) config.idle_in_transaction_session_timeout = idleInTx;
  return config;
}

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { buildPoolConfig } from "./poolConfig";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool(buildPoolConfig(process.env.DATABASE_URL));
// An idle client dropped by the server (restart, failover, pooler recycle) emits
// 'error' on the pool; with no listener Node treats that as uncaught and exits.
pool.on("error", (err) => {
  console.error("[db] idle client error", err.message);
});
export const db = drizzle(pool, { schema });

// Read-replica-ready query layer. When DATABASE_READ_URL is set, `readDb` talks
// to a replica; otherwise it IS `db`. Use it only for reads that tolerate
// replication lag (public search, listings). Anything that reads right after
// its own write must keep using `db`.
export const readPool = process.env.DATABASE_READ_URL
  ? new Pool(buildPoolConfig(process.env.DATABASE_READ_URL))
  : pool;
if (readPool !== pool) {
  readPool.on("error", (err) => {
    console.error("[db] idle read client error", err.message);
  });
}
export const readDb = readPool === pool ? db : drizzle(readPool, { schema });

export * from "./schema";

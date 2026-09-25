import pg from "pg";

const VALID_DB_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Creates the target database if it doesn't exist yet, connecting to the
 * server's default `postgres` maintenance database to issue CREATE DATABASE. */
export async function ensureDatabaseExists(targetUrl: string): Promise<void> {
  const parsed = new URL(targetUrl);
  const dbName = parsed.pathname.replace(/^\/+/, "");
  if (!VALID_DB_NAME.test(dbName)) {
    throw new Error(`Refusing to create database with unexpected name: ${JSON.stringify(dbName)}`);
  }

  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = "/postgres";

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (rows.length === 0) {
      // Database names can't be parameterized; validated against VALID_DB_NAME above.
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

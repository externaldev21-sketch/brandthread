#!/usr/bin/env node
/**
 * Ordered SQL migration runner for @workspace/db.
 *
 * Applies every migrations/*.sql in filename order, exactly once, recording
 * applied files in schema_migrations. Migration files are written
 * idempotently (IF NOT EXISTS), so re-running against an existing database
 * is safe; the tracking table keeps runs fast and future-proofs any
 * non-idempotent file.
 *
 * Fresh database boot: `pnpm run setup`
 *   (drizzle push creates the base schema, then this runner applies the
 *    SQL migrations on top).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const done = new Set(rows.map((r) => r.filename));

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied++;
      console.log("ok");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED\n${file}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log(
    applied === 0
      ? `up to date (${files.length} migrations recorded)`
      : `applied ${applied} migration(s); ${files.length} total`,
  );
} finally {
  await client.end();
}

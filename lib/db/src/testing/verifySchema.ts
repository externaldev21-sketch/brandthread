import pg from "pg";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../schema";

// Derive the minimum from the real schema, not a hand-maintained list that can
// quietly stop checking newly added tables. Extra migration-owned objects are OK.
const expectedTables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableConfig(table));

export async function assertTestSchema(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(`
    SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE t.table_type = 'BASE TABLE'
  `);
  const actual = new Set(rows.map((row) =>
    `${row.table_schema}.${row.table_name}.${row.column_name}`));
  const missing = expectedTables.flatMap((table) =>
    table.columns
      .map((column) => `${table.schema ?? "public"}.${table.name}.${column.name}`)
      .filter((column) => !actual.has(column)));
  if (missing.length) {
    throw new Error(
      `[api-server tests] Test database schema is incomplete: missing ${missing.length} ` +
      `required table/column(s): ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""}. ` +
      "Tests cannot proceed. Use a new, empty dedicated TEST_DATABASE_URL " +
      "or repair the dedicated test schema explicitly; setup will not reset existing data.",
    );
  }
}

/** Read-only last-line-of-defense check before suites execute. */
export async function verifyTestDatabaseSchema(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await assertTestSchema(client);
  } finally {
    await client.end();
  }
}
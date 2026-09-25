#!/usr/bin/env -S tsx
/**
 * Finds and deletes rows fabricated by the api-server integration test suite
 * (real users' dev/prod database is normally never touched by tests anymore —
 * this script is for cleaning up the mess left behind before that isolation
 * existed). Matches ONLY the explicit test-data signatures in
 * @workspace/db/testing/signatures.ts (reserved test-only email TLDs,
 * moneyHarness clerkId prefixes, the money-harness manufacturer naming
 * convention) — never anything that merely "looks fake".
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run db:purge-test-data           # dry run (default)
 *   pnpm --filter @workspace/api-server run db:purge-test-data -- --confirm   # actually deletes
 */
import pg from "pg";
import { purgeTestData } from "@workspace/db/testing";

const confirm = process.argv.includes("--confirm");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await purgeTestData(client, { dryRun: !confirm });

    if (!result.tables.length) {
      console.log("No test-signature rows found. Nothing to do.");
    } else {
      console.log(`${confirm ? "Deleted" : "Would delete"} rows by table:`);
      for (const { table, matched } of result.tables) {
        console.log(`  ${table.padEnd(32)} ${matched}`);
      }
      console.log(`Total: ${result.totalMatched} row(s).`);
    }

    if (confirm) {
      await client.query("COMMIT");
      console.log("\nCommitted.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nDry run only — nothing was deleted. Re-run with --confirm to delete these rows.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

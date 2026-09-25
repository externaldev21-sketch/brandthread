import { afterAll } from "vitest";
import pg from "pg";
import { purgeTestData } from "@workspace/db/testing";

// Runs once per test file (setupFiles execute in each file's own context).
// Every seeding helper in this suite (moneyHarness.ts, per-route integration
// tests, ...) creates users/rows that match the same test-data signatures the
// purge script uses (see @workspace/db/testing/signatures.ts), so rather than
// hand-instrumenting every harness with its own afterAll teardown, one shared
// hook sweeps anything matching those signatures out of the (isolated) test
// database after each file's tests finish.
afterAll(async () => {
  const url = process.env.BRANDTHREAD_TEST_DATABASE_URL;
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await purgeTestData(client, { dryRun: false });
  } finally {
    await client.end();
  }
});

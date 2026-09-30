import { afterAll } from "vitest";

// The pre-guarantee money suites assert that a seller is paid at checkout.
// Production defaults to PAYOUT_MODE=hold (paid after delivery); the delivery
// guarantee suite (lib/delivery/__tests__) sets "hold" explicitly and
// policy.test.ts pins the default.
process.env.PAYOUT_MODE ??= "immediate";
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

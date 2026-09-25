import pg from "pg";

/**
 * Runs once for the whole `vitest run`, in the main process, before any test
 * file executes. This is the last line of defense against ever running
 * DB-backed tests against the owner's real database: it re-checks the exact
 * env state vitest.config.ts computed rather than trusting it blindly.
 */
export default async function globalSetup() {
  const testUrl = process.env.BRANDTHREAD_TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "vitest.global-setup.ts ran without BRANDTHREAD_TEST_DATABASE_URL set — " +
        "vitest.config.ts should have resolved an isolated test database before this ran.",
    );
  }
  if (process.env.DATABASE_URL !== testUrl) {
    throw new Error(
      "DATABASE_URL does not match the resolved test database. Refusing to run tests " +
        "rather than risk writing to the wrong database.",
    );
  }
  const realSnapshot = process.env.BRANDTHREAD_REAL_DATABASE_URL_SNAPSHOT;
  if (realSnapshot && realSnapshot === testUrl) {
    throw new Error("Resolved test database is identical to the real DATABASE_URL. Refusing to run tests.");
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    await client.end();
  }
}

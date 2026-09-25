/**
 * Pure resolution logic for picking a Postgres URL to run tests against.
 * No I/O here — connecting, creating databases, and migrating happen in
 * ensureDatabase.ts / runMigrations.ts so this stays trivially unit-testable.
 */

export type TestDatabaseResolution =
  | { ok: true; url: string; derivedFrom: "TEST_DATABASE_URL" | "derived" }
  | { ok: false; fatal: true; reason: string }
  | { ok: false; fatal: false; reason: string };

function sameDatabase(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.hostname === ub.hostname &&
      (ua.port || "5432") === (ub.port || "5432") &&
      ua.pathname === ub.pathname
    );
  } catch {
    return a === b;
  }
}

/** Appends (or strengthens) a `_test` suffix on the database name so the derived
 * URL can never resolve to the same database as the input. */
export function deriveTestDatabaseName(dbName: string): string {
  const trimmed = dbName.replace(/^\/+/, "");
  if (!trimmed) return "test";
  return trimmed.endsWith("_test") ? `${trimmed}_test2` : `${trimmed}_test`;
}

export function deriveTestDatabaseUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const dbName = parsed.pathname.replace(/^\/+/, "");
  parsed.pathname = `/${deriveTestDatabaseName(dbName)}`;
  return parsed.toString();
}

/**
 * Resolves which Postgres URL the test run should use.
 *
 * - TEST_DATABASE_URL set: use it verbatim. If it happens to point at the
 *   exact same database as DATABASE_URL, that is a configuration mistake
 *   that would write test rows into the real database — fail hard rather
 *   than silently running.
 * - Only DATABASE_URL set: derive `<db>_test` on the same server.
 * - Neither set: no database available; callers should skip DB-backed tests.
 */
export function resolveTestDatabaseUrl(env: {
  databaseUrl?: string | undefined;
  testDatabaseUrl?: string | undefined;
}): TestDatabaseResolution {
  const { databaseUrl, testDatabaseUrl } = env;

  if (testDatabaseUrl) {
    if (databaseUrl && sameDatabase(testDatabaseUrl, databaseUrl)) {
      return {
        ok: false,
        fatal: true,
        reason:
          "TEST_DATABASE_URL resolves to the same database as DATABASE_URL. " +
          "Tests must never run against the real database — point TEST_DATABASE_URL " +
          "at a separate database (e.g. a `<name>_test` database).",
      };
    }
    return { ok: true, url: testDatabaseUrl, derivedFrom: "TEST_DATABASE_URL" };
  }

  if (databaseUrl) {
    const derived = deriveTestDatabaseUrl(databaseUrl);
    if (sameDatabase(derived, databaseUrl)) {
      return {
        ok: false,
        fatal: true,
        reason: `Refusing to run tests: derived test database URL is identical to DATABASE_URL (${derived}).`,
      };
    }
    return { ok: true, url: derived, derivedFrom: "derived" };
  }

  return {
    ok: false,
    fatal: false,
    reason:
      "No DATABASE_URL or TEST_DATABASE_URL is configured, so there is no database to test against.",
  };
}

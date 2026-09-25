import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Imported by relative path (not the `@workspace/db/testing` package
// specifier) so Vite's esbuild-based config loader inlines and transpiles
// this TS module tree itself, rather than handing a bare specifier to plain
// Node's ESM resolver — which can't follow the extensionless internal
// imports these files use everywhere else in the monorepo.
import {
  ensureDatabaseExists,
  resolveTestDatabaseUrl,
  runDrizzlePushAgainst,
  runMigrationsAgainst,
} from "../../lib/db/src/testing/index";
import { collectTestFiles, needsRealDatabase } from "./src/testUtils/dbFileScan";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "src");

const resolution = resolveTestDatabaseUrl({
  databaseUrl: process.env.DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
});

if (!resolution.ok && resolution.fatal) {
  // Never let a misconfigured TEST_DATABASE_URL silently fall through to the
  // real database — refuse to even collect tests.
  throw new Error(`[api-server tests] ${resolution.reason}`);
}

let exclude: string[] = [];

if (resolution.ok) {
  // Preserve the real DATABASE_URL (if any) under a different name so
  // vitest.global-setup.ts can assert we never ended up pointed back at it.
  if (process.env.DATABASE_URL) {
    process.env.BRANDTHREAD_REAL_DATABASE_URL_SNAPSHOT = process.env.DATABASE_URL;
  }
  await ensureDatabaseExists(resolution.url);
  await runDrizzlePushAgainst(resolution.url);
  await runMigrationsAgainst(resolution.url);
  // Setting this here (main thread, before the worker pool forks) means every
  // test file's `@workspace/db` import resolves against the isolated test
  // database, not whatever DATABASE_URL pointed at in the shell.
  process.env.DATABASE_URL = resolution.url;
  process.env.BRANDTHREAD_TEST_DATABASE_URL = resolution.url;
} else {
  console.warn(`\n[api-server tests] Skipping DB-backed tests: ${resolution.reason}\n`);
  const dbFiles = collectTestFiles(srcDir).filter(needsRealDatabase);
  exclude = dbFiles.map((f) => path.relative(here, f).split(path.sep).join("/"));
  if (dbFiles.length) {
    console.warn(
      `[api-server tests] Skipped ${dbFiles.length} DB-backed test file(s). ` +
        `Set TEST_DATABASE_URL (or DATABASE_URL) to a reachable Postgres instance to run them.\n`,
    );
  }
}

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...exclude],
    globalSetup: resolution.ok ? [path.join(here, "vitest.global-setup.ts")] : [],
    setupFiles: resolution.ok ? [path.join(here, "vitest.setup.ts")] : [],
    // DB-backed test files share one Postgres database and clean up their own
    // rows (by test-data signature, see vitest.setup.ts) in afterAll. Running
    // files in parallel would let one file's cleanup race another file's
    // still-in-flight seeding against the same signatures, so files run
    // one at a time whenever real DB-backed suites are in play.
    fileParallelism: resolution.ok ? false : true,
  },
});

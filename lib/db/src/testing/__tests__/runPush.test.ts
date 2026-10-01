import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { runMigrationsAgainst } from "../runMigrations";
import { runDrizzlePushAgainst } from "../runPush";
import { verifyTestDatabaseSchema } from "../verifySchema";
import {
  API_SERVER_DIR,
  DB_PACKAGE_DIR,
  EphemeralPostgres,
  postgresToolsAvailable,
  runCommand,
} from "./ephemeralPostgres";

const describeWithPostgres = describe.skipIf(!postgresToolsAvailable);

describeWithPostgres("test database schema bootstrap", () => {
  let postgres: EphemeralPostgres | undefined;

  beforeAll(async () => {
    postgres = await EphemeralPostgres.start();
  }, 180_000);

  afterAll(async () => {
    await postgres?.stopAndRemove();
  }, 60_000);

  it("bootstraps a fresh schema and permits the migration runner to pass twice", async () => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("fresh"),
    );

    await runDrizzlePushAgainst(databaseUrl);
    await verifyTestDatabaseSchema(databaseUrl);
    await runMigrationsAgainst(databaseUrl);
    await runMigrationsAgainst(databaseUrl);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM schema_migrations",
      );
      expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
      await expect(client.query("SELECT clerk_id FROM users LIMIT 0")).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  }, 300_000);

  it("reuses a complete provisioned database and preserves its sentinel data", async () => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("existing"),
    );

    await runDrizzlePushAgainst(databaseUrl);
    await runMigrationsAgainst(databaseUrl);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        CREATE TABLE bootstrap_sentinel (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        )
      `);
      await client.query(
        "INSERT INTO bootstrap_sentinel (id, payload) VALUES ($1, $2)",
        ["preserve-me", "test database data survives bootstrap"],
      );
    } finally {
      await client.end();
    }

    await runDrizzlePushAgainst(databaseUrl);
    await verifyTestDatabaseSchema(databaseUrl);
    await runMigrationsAgainst(databaseUrl);
    await runMigrationsAgainst(databaseUrl);

    const verify = new pg.Client({ connectionString: databaseUrl });
    await verify.connect();
    try {
      const sentinel = await verify.query<{ payload: string }>(
        "SELECT payload FROM bootstrap_sentinel WHERE id = $1",
        ["preserve-me"],
      );
      expect(sentinel.rows).toEqual([
        { payload: "test database data survives bootstrap" },
      ]);
    } finally {
      await verify.end();
    }
  }, 300_000);

  it("rejects renamed-column drift before migrations and recommends TEST_DATABASE_URL", async () => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("incomplete"),
    );

    await runDrizzlePushAgainst(databaseUrl);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        "ALTER TABLE public.users RENAME COLUMN clerk_id TO bootstrap_drifted_clerk_id",
      );
    } finally {
      await client.end();
    }

    await expect(verifyTestDatabaseSchema(databaseUrl)).rejects.toThrow(
      /incomplete.*public\.users\.clerk_id.*TEST_DATABASE_URL/is,
    );
    await expect(runDrizzlePushAgainst(databaseUrl)).rejects.toThrow(
      /incomplete.*public\.users\.clerk_id.*TEST_DATABASE_URL/is,
    );

    const verify = new pg.Client({ connectionString: databaseUrl });
    await verify.connect();
    try {
      const drift = await verify.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name IN ('clerk_id', 'bootstrap_drifted_clerk_id')
      `);
      expect(drift.rows.map((row) => row.column_name)).toEqual([
        "bootstrap_drifted_clerk_id",
      ]);
      const migrations = await verify.query<{ relation: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS relation",
      );
      expect(migrations.rows[0]?.relation).toBeNull();
    } finally {
      await verify.end();
    }
  }, 180_000);

  it("captures the legacy no-TTY drizzle push prompt-and-zero-exit failure when present", async ({
    skip,
  }) => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("legacy_push_drift"),
    );
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("CREATE TABLE users (id integer PRIMARY KEY, bootstrap_drifted_clerk_id text)");
    } finally {
      await client.end();
    }

    // A minimal schema isolates the rename prompt from unrelated introspection
    // differences in the product's much larger schema. Place it under lib/db
    // so its drizzle-orm import resolves normally, then always remove it.
    const fixtureDir = await mkdtemp(path.join(DB_PACKAGE_DIR, ".legacy-push-"));
    const fixtureSchema = path.join(fixtureDir, "schema.ts");
    await writeFile(fixtureSchema, `
      import { pgTable, integer, text } from "drizzle-orm/pg-core";
      export const users = pgTable("users", {
        id: integer("id").primaryKey(),
        clerkId: text("clerk_id"),
      });
    `);
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    env.DATABASE_URL = databaseUrl;
    let legacyResult;
    try {
      legacyResult = await runCommand(
        "pnpm",
        [
          "exec", "drizzle-kit", "push", "--force",
          "--dialect", "postgresql", "--schema", fixtureSchema, "--url", databaseUrl,
        ],
        { cwd: DB_PACKAGE_DIR, env, timeoutMs: 30_000 },
      );
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
    const legacyOutput = `${legacyResult.stdout}\n${legacyResult.stderr}`;

    const inspect = new pg.Client({ connectionString: databaseUrl });
    await inspect.connect();
    let expectedColumnIsMissing = false;
    try {
      const columns = await inspect.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'clerk_id'
      `);
      expectedColumnIsMissing = columns.rows.length === 0;
    } finally {
      await inspect.end();
    }

    if (legacyResult.code !== 0) {
      skip(
        `Installed drizzle-kit now reports non-interactive push failure with a nonzero exit (${legacyResult.code}).`,
      );
    }

    expect(legacyResult.code).toBe(0);
    expect(legacyOutput).toMatch(/Interactive prompts require a TTY/);
    expect(expectedColumnIsMissing).toBe(true);
  }, 120_000);

  it("runs API Vitest config and global setup against the ephemeral DB in non-TTY mode", async () => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("api_orchestration"),
    );
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    delete env.BRANDTHREAD_TEST_DATABASE_URL;
    delete env.BRANDTHREAD_REAL_DATABASE_URL_SNAPSHOT;
    env.TEST_DATABASE_URL = databaseUrl;

    const result = await runCommand(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "src/middlewares/__tests__/errorHandling.test.ts",
        "--reporter=dot",
      ],
      { cwd: API_SERVER_DIR, env, timeoutMs: 240_000 },
    );

    expect(
      result.code,
      `API Vitest orchestration failed.\n${result.stdout}\n${result.stderr}`,
    ).toBe(0);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const migrations = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM schema_migrations",
      );
      expect(Number(migrations.rows[0]?.count)).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  }, 300_000);

  it("makes API Vitest config refuse an incomplete DB before running migrations", async () => {
    const databaseUrl = await postgres!.createDatabase(
      postgres!.newDatabaseName("api_incomplete"),
    );
    await runDrizzlePushAgainst(databaseUrl);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        "ALTER TABLE public.users RENAME COLUMN clerk_id TO bootstrap_drifted_clerk_id",
      );
    } finally {
      await client.end();
    }

    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    delete env.BRANDTHREAD_TEST_DATABASE_URL;
    delete env.BRANDTHREAD_REAL_DATABASE_URL_SNAPSHOT;
    env.TEST_DATABASE_URL = databaseUrl;
    const result = await runCommand(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "src/middlewares/__tests__/errorHandling.test.ts",
        "--reporter=dot",
      ],
      { cwd: API_SERVER_DIR, env, timeoutMs: 180_000 },
    );

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /incomplete.*public\.users\.clerk_id.*TEST_DATABASE_URL/is,
    );

    const verify = new pg.Client({ connectionString: databaseUrl });
    await verify.connect();
    try {
      const migrations = await verify.query<{ relation: string | null }>(
        "SELECT to_regclass('public.schema_migrations')::text AS relation",
      );
      expect(migrations.rows[0]?.relation).toBeNull();
    } finally {
      await verify.end();
    }
  }, 240_000);
});

describe.skipIf(postgresToolsAvailable)(
  "test database schema bootstrap (PostgreSQL tools unavailable)",
  () => {
    it.skip(
      "requires local initdb and pg_ctl executables; set neither production nor test database URL",
      () => undefined,
    );
  },
);

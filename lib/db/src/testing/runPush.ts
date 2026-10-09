import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";
import { assertTestSchema } from "./verifySchema";

const DB_PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Generate from an empty migration history, so there are no rename decisions
 * or data-loss prompts. Do not use push: its CLI can catch errors and exit 0. */
async function generateBaseSql(out: string, databaseUrl: string): Promise<string[]> {
  const diagnostics = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec", "drizzle-kit", "generate",
        "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--out", out,
      ],
      {
        cwd: DB_PACKAGE_DIR,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    let output = "";
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[redacted database URL]"));
      else reject(new Error(
        `drizzle-kit generate exited with code ${code}${signal ? ` (signal ${signal})` : ""}. ` +
        output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[redacted database URL]"),
      ));
    });
  });
  const files = (await readdir(out)).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) {
    throw new Error(
      "drizzle-kit generate produced no SQL despite exiting successfully. " +
      `Check the schema/config and installed drizzle-kit version. ${diagnostics}`,
    );
  }
  return Promise.all(files.map((file) => readFile(path.join(out, file), "utf8")));
}

/** Bootstrap ONLY an explicitly resolved dedicated test database.
 * Retains the historical name for callers; no interactive push runs anymore.
 * Complete existing schemas are reused without DDL; partial schemas fail closed.
 */
export async function runDrizzlePushAgainst(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  let out: string | undefined;
  try {
    await client.connect();
    await client.query("BEGIN");
    // Serializes simultaneous setup attempts on this database without touching
    // application rows or any other database.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('brandthread-test-schema-bootstrap'))");
    const { rows } = await client.query(`
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      LIMIT 1
    `);
    if (!rows.length) {
      out = await mkdtemp(path.join(tmpdir(), "brandthread-test-schema-"));
      const statements = await generateBaseSql(out, databaseUrl);
      for (const sql of statements) await client.query(sql);
    }
    await assertTestSchema(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const detail = (error instanceof Error ? error.message : "Unknown schema preparation error")
      .replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, "[redacted database URL]");
    throw new Error(
      `[api-server tests] Dedicated test database schema preparation failed. ${detail} ` +
      "Migrations and suites have not started. Check test database permissions and schema configuration.",
      { cause: error },
    );
  } finally {
    await client.end();
    if (out) await rm(out, { recursive: true, force: true });
  }
}

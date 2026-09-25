import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const MIGRATE_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "migrate.mjs",
);

/** Runs the ordered SQL migration runner against an explicit database URL,
 * never against `process.env.DATABASE_URL` directly. */
export async function runMigrationsAgainst(databaseUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [MIGRATE_SCRIPT], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`migrate.mjs exited with code ${code}`));
    });
  });
}

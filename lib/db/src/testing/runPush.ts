import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const DB_PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runs `drizzle-kit push --force` (creates the base schema from
 * lib/db/src/schema) against an explicit database URL. Fresh test databases
 * have no schema at all yet, so this must run before the SQL migrations in
 * runMigrations.ts, exactly like @workspace/db's own `setup` script. */
export async function runDrizzlePushAgainst(databaseUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npx",
      ["drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"],
      {
        cwd: DB_PACKAGE_DIR,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit push exited with code ${code}`));
    });
  });
}

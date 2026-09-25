import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DB_OP_PATTERN = /\bdb\.(insert|select|update|delete|execute|transaction)\s*\(/;

/** True if a test file will hit a real Postgres connection when run: it
 * imports `@workspace/db` and either calls a real db.<verb>(...) itself or
 * pulls in the money-test harness (which does). Files that only
 * `vi.mock("@workspace/db", ...)` without calling through to the real client
 * never execute the real module, so they're excluded here. */
export function needsRealDatabase(filePath: string): boolean {
  const content = readFileSync(filePath, "utf8");
  if (!content.includes("@workspace/db")) return false;
  return DB_OP_PATTERN.test(content) || content.includes("moneyHarness");
}

export function collectTestFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

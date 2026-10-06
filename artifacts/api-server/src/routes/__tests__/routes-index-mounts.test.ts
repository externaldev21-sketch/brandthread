/**
 * Regression guard (QA-0156): routes/index.ts imported packagePresetsRouter
 * but never mounted it, so every /api/package-presets call 404'd. Every
 * router imported into the index must be passed to router.use(...).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "..", "index.ts"), "utf8");

function importedRouters(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/^import\s+(\w+Router)\s+from\s+["']\.\/[^"']+["'];?/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^import\s*\{([^}]+)\}\s*from\s+["']\.\/[^"']+["'];?/gm)) {
    for (const part of m[1].split(",")) {
      const local = part.split(/\s+as\s+/).pop()?.trim();
      if (local && /Router$/.test(local)) names.add(local);
    }
  }
  return [...names];
}

describe("routes/index.ts", () => {
  it("mounts every router it imports", () => {
    const routers = importedRouters(source);
    expect(routers.length).toBeGreaterThan(20);
    const body = source.replace(/^import[^;]+;/gm, "");
    const unmounted = routers.filter(name => !new RegExp(`\\b${name}\\b`).test(body));
    expect(unmounted).toEqual([]);
  });

  it("mounts the package presets router at /package-presets", () => {
    expect(source).toMatch(/router\.use\(\s*["']\/package-presets["'][^)]*packagePresetsRouter/);
  });
});

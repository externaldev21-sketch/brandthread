import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'lint', 'no-unstable-effect-deps.mjs');

/**
 * Runs the static "Maximum update depth exceeded" infinite-loop guard
 * (scripts/lint/no-unstable-effect-deps.mjs) as part of `pnpm test`, so a
 * regression of the app/boost.tsx crash class is caught in the same place
 * every other unit test is, without a separate CI step. See that script's
 * own header comment for exactly what it checks and why it's a source-text
 * scan rather than a real ESLint rule (no custom-rule package in this repo).
 */
describe('no-unstable-effect-deps lint', () => {
  it('finds no fresh-every-render array/object used as a useEffect/useMemo/useCallback dependency', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'lint', 'no-thin-partial-opacity-overlay.mjs');

/**
 * Runs the static "thin dark bar over the tab bar" guard
 * (scripts/lint/no-thin-partial-opacity-overlay.mjs) as part of `pnpm test`
 * so a regression is caught in the same place every other unit test is,
 * without needing a separate CI step wired up. See that script's own header
 * comment for what it checks and why it's a source-text scan rather than a
 * real ESLint rule (no custom-rule package set up in this repo).
 */
describe('no-thin-partial-opacity-overlay lint', () => {
  it('finds no absolute/fixed, under-40pt, partial-opacity bar in app/ or components/', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });
});

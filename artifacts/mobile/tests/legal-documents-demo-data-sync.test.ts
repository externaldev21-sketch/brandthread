import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '../content/legal';

/**
 * scripts/store-screenshots/demo-data.mjs duplicates LEGAL_VERSION as
 * DEMO_LEGAL_VERSION (it runs under plain `node`, not a TS-aware runtime, so
 * it can't import content/legal.ts directly). Without it, the demo seller/
 * buyer profile's termsVersion is stale the moment content/legal.ts's
 * LEGAL_VERSION is bumped, and LegalAcceptanceGate blocks every screenshot
 * capture with the "Before you continue" gate instead of the real screen.
 * This fails loudly the moment the two values drift instead of silently
 * breaking every future screenshot run.
 */
describe('screenshot demo data terms version stays in sync', () => {
  it('matches content/legal.ts LEGAL_VERSION', () => {
    const demoData = readFileSync(
      resolve(__dirname, '../scripts/store-screenshots/demo-data.mjs'),
      'utf8',
    );
    const match = demoData.match(/const DEMO_LEGAL_VERSION = '([^']+)'/);
    expect(match, 'DEMO_LEGAL_VERSION constant not found in demo-data.mjs').not.toBeNull();
    expect(match?.[1]).toBe(LEGAL_VERSION);
  });
});

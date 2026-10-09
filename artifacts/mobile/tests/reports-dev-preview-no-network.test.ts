import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (reports/blocks: buyer-blocked, buyer-problem-report).
 *
 * buyer-blocked crashed with "Cannot read properties of undefined (reading
 * 'length')" in every session (real or preview): the audit's demo API mock
 * seeded /safety/muted-words as a bare array, but api.safety.mutedWords()
 * always reads `.words.length` off the response, expecting `{ words, limit }`
 * — a seed-shape bug in the mock, not the screen. (Fixed independently
 * upstream by the time this branch merged `dev` in; this test just locks
 * in the shape either fix leaves in place.)
 *
 * buyer-problem-report 404'd fetching a single order (getBuyerOrder) because
 * it always tries the real API first regardless of preview mode, and the
 * audit's synthesized orderId has no real order behind it. Fixed by skipping
 * the real fetch in dev-preview and going straight to the local cache lookup
 * (which already exists for the "server unavailable" case).
 */
describe('reports/blocks screens never hit a broken network dependency in dev-preview', () => {
  it('demo-data.mjs seeds /safety/muted-words with the real { words, limit } shape, not a bare array', () => {
    const src = read('scripts/store-screenshots/demo-data.mjs');
    expect(src).toContain("if (p === '/safety/muted-words') return { words: [], limit: 50 };");
  });

  it('orderService.getBuyerOrder skips the real single-order fetch in any dev-preview session', () => {
    const src = read('services/orderService.ts');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';");
    expect(src).toContain('if (!isSellerDevPreview() && !isBuyerDevPreview()) {');
  });
});

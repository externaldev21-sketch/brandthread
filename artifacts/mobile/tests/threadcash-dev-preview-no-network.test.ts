import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (Thread Cash: thread-cash, thread-checkout,
 * thread-explainer, thread-product-detail).
 *
 * thread-cash.tsx already had a dev-preview fallback for the buyer role
 * (isBuyerDevPreview()), but not the seller role — a seller preview session
 * still hit the real, buyer-only api.threadCash.get()/.history() calls and
 * 404'd. Thread Cash is a buyer-only balance, so a seller preview has
 * nothing real to fetch either; extended the same guard to cover it.
 */
describe('thread-cash never hits the real buyer-only balance API in a seller dev-preview session', () => {
  it('app/thread-cash.tsx skips the real API call for both seller and buyer dev-preview', () => {
    const src = read('app/thread-cash.tsx');
    expect(src).toContain("import { isBuyerDevPreview, isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';");
    expect(src).toContain('if (isBuyerDevPreview() || isSellerDevPreview()) {');
  });
});

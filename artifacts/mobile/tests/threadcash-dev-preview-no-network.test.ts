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
 * still hit the real api.threadCash.get()/.history() calls and 404'd, since
 * this app's own audit/e2e sandbox has no real backend behind them for
 * either role. (Thread Cash balances are shared between buyers and sellers
 * — sellers can send/receive it in seller-conversation messages, same as
 * buyers — this was never a buyer-only restriction, just a preview-sandbox
 * gap.) Extended the same guard to cover the seller role too.
 */
describe('thread-cash never hits the real balance API in a seller dev-preview session', () => {
  it('app/thread-cash.tsx skips the real API call for both seller and buyer dev-preview', () => {
    const src = read('app/thread-cash.tsx');
    expect(src).toContain("import { isBuyerDevPreview, isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';");
    expect(src).toContain('if (isBuyerDevPreview() || isSellerDevPreview()) {');
  });
});

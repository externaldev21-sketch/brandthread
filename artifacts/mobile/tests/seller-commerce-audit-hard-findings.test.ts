/**
 * Half-done audit (#506) — seller commerce hard findings.
 *
 * 76 of the 79 hard findings on this area's routes were an identical
 * "Failed to load resource: 404" console error, on detail screens reached
 * via a bare URL with no id param (as the audit crawler does). Several of
 * these screens already guarded against fetching without a real id; a few
 * did not — dispute-detail.tsx in particular fell through to a
 * preview-only legacy fetch *unconditionally* whenever disputeId was
 * missing, not just in dev preview (the `if (disputeId) {...}` block was
 * simply skipped without throwing, so the catch-block's `isSellerDevPreview()`
 * gate never ran). These tests lock in that every affected screen's load
 * function returns before firing any network request when its id is absent.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('detail screens never fetch without their required id', () => {
  it('dispute-detail.tsx returns before any fetch (real or preview-legacy) when disputeId is missing', () => {
    const source = read('app/dispute-detail.tsx');
    const loadStart = source.indexOf('const load = useCallback(async () => {');
    const guardIdx = source.indexOf('if (!disputeId) {', loadStart);
    const tryIdx = source.indexOf('try {', loadStart);
    expect(guardIdx).toBeGreaterThan(-1);
    // The guard must come before the try block that contains both the real
    // API call and (on any caught error) the preview-only legacy fallback —
    // otherwise a missing disputeId can still reach that fallback path
    // unconditionally, the exact leak this guards against.
    expect(guardIdx).toBeLessThan(tryIdx);
  });

  it('order-detail.tsx returns before fetching when id is missing', () => {
    const source = read('app/order-detail.tsx');
    const loadStart = source.indexOf('const load = useCallback(async (generation: number) => {');
    const guardIdx = source.indexOf('if (!id) {', loadStart);
    const returnsFetchIdx = source.indexOf('api.returns.listSeller()', loadStart);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(returnsFetchIdx);
  });

  it('refund-detail.tsx returns before fetching when orderId is missing', () => {
    const source = read('app/refund-detail.tsx');
    const loadStart = source.indexOf('const load = useCallback(async () => {');
    const guardIdx = source.indexOf('if (!orderId) {', loadStart);
    const fetchIdx = source.indexOf('api.orders.get(orderId)', loadStart);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  it('fulfill-order.tsx returns before fetching when orderId is missing', () => {
    const source = read('app/fulfill-order.tsx');
    const loadStart = source.indexOf('const load = useCallback(async () => {');
    const guardIdx = source.indexOf('if (!orderId) {', loadStart);
    const fetchIdx = source.indexOf('api.orders.get(orderId)', loadStart);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(fetchIdx);
  });

  it('return-detail.tsx, fulfill-batch.tsx and product-size-chart.tsx were already guarded (no change needed)', () => {
    expect(read('app/return-detail.tsx')).toContain("if (!returnId) { setLoadError('not_found'); setLoading(false); return; }");
    // fulfill-batch derives its id list from a comma-joined query param;
    // an absent param collapses to an empty list, so its fetch loop simply
    // never runs — no explicit guard needed, but the shape must stay this way.
    expect(read('app/fulfill-batch.tsx')).toContain(".split(',').map(id => id.trim()).filter(Boolean)");
    expect(read('app/product-size-chart.tsx')).toContain('if (!productId || !userId) { setLoading(false); return; }');
  });
});

describe('customer-accounts.tsx: no banned placeholder-copy wording', () => {
  it('does not use the "not available yet" phrase the audit flags', () => {
    const source = read('app/customer-accounts.tsx');
    expect(source).not.toMatch(/not available yet/i);
  });
});

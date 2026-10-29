/**
 * Audit regression: ProductSaveStatsRow kept showing the previous product's
 * save stats when productId changed and the new product's request failed.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { saveStats, api } = vi.hoisted(() => {
  const saveStats = vi.fn();
  return { saveStats, api: { products: { saveStats } } };
});
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/components/BrandthreadUI', () => ({
  SectionHeader: () => null,
  StatCard: (props: Record<string, unknown>) => React.createElement('StatCard', props),
}));

const { ProductSaveStatsRow } = await import('../ProductSaveStatsRow');

describe('ProductSaveStatsRow — product change', () => {
  it("drops the previous product's stats when the new product's request fails", async () => {
    saveStats.mockResolvedValueOnce({ saves: 7, priceAlertsOn: 1, backInStockReached: 2, priceDropReached: 3 });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProductSaveStatsRow productId="p1" />); });
    expect(r.root.findAll((n) => (n.type as unknown) === 'StatCard').length).toBe(4);
    saveStats.mockRejectedValueOnce(new Error('404'));
    await act(async () => { r.update(<ProductSaveStatsRow productId="p2" />); });
    expect(r.root.findAll((n) => (n.type as unknown) === 'StatCard').length).toBe(0);
    r.unmount();
  });
});

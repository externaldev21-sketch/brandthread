import { describe, expect, it, vi } from 'vitest';

const completeTask = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/setupStore', () => ({ completeTask: (...a: unknown[]) => completeTask(...a) }));

import { createdProductIds, publishProducts } from './bulkPublish';

describe('publishProducts', () => {
  it('publishes in chunks of 200 and ticks the first-product task', async () => {
    const status = vi.fn(async ({ productIds }: { productIds: string[]; status: string }) => ({ updated: productIds, unchanged: [] as string[] }));
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
    const out = await publishProducts({ productBulk: { status } }, ids);
    expect(status).toHaveBeenCalledTimes(3);
    expect(status.mock.calls.map(([b]) => b.productIds.length)).toEqual([200, 200, 50]);
    expect(status.mock.calls[0][0].status).toBe('active');
    expect(out).toEqual({ published: 450, alreadyLive: 0 });
    expect(completeTask).toHaveBeenCalledWith('first_product');
  });

  it('does not tick the task when nothing went live', async () => {
    completeTask.mockClear();
    const status = vi.fn(async (_body: { productIds: string[]; status: string }) => ({ updated: [] as string[], unchanged: [] as string[] }));
    await publishProducts({ productBulk: { status } }, ['a']);
    expect(completeTask).not.toHaveBeenCalled();
  });
});

describe('createdProductIds', () => {
  it('keeps only created rows with an id', () => {
    expect(createdProductIds([
      { action: 'created', productId: 'a' }, { action: 'updated', productId: 'b' }, { action: 'created' }, { action: 'failed' },
    ])).toEqual(['a']);
  });
});

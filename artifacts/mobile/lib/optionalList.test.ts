import { describe, expect, it } from 'vitest';
import { optionalList } from './optionalList';

describe('optionalList (BT-398)', () => {
  it('passes a list through', async () => {
    expect(await optionalList(async () => [1, 2])).toEqual([1, 2]);
  });

  it('turns a plan-gated 403 or a non-list into an empty list', async () => {
    expect(await optionalList(async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); })).toEqual([]);
    expect(await optionalList(async () => ({ error: 'nope' }))).toEqual([]);
  });

  it('a failed optional call never fails the batch it is part of', async () => {
    const [orders, threads] = await Promise.all([
      Promise.resolve(['order']),
      optionalList(() => Promise.reject(new Error('PLAN_REQUIRED'))),
    ]);
    expect(orders).toEqual(['order']);
    expect(threads).toEqual([]);
  });
});

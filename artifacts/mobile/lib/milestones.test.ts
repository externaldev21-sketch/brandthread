import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
  },
}));

import { buildPreviewMilestone, formatReachedDate, readPreviewSeen, writePreviewSeen } from './milestones';

const identity = { storeName: 'Preview Studio', handle: 'preview_studio', productImageUrl: 'https://img.test/tee.jpg' };
const now = new Date('2026-10-13T16:00:00Z');
const paid = (totalCents: number, status = 'fulfilled') => ({ status, paidAt: '2026-10-01T00:00:00Z', totalCents });

describe('buildPreviewMilestone', () => {
  it('a fresh store has none', () => {
    expect(buildPreviewMilestone([], identity, now)).toBeNull();
  });

  it('picks the highest reached, counting only paid, non-cancelled orders', () => {
    expect(buildPreviewMilestone([paid(500)], identity, now)?.key).toBe('first_sale');
    expect(buildPreviewMilestone([paid(100_000)], identity, now)?.label).toBe('$1,000 in sales');
    expect(buildPreviewMilestone([paid(100_000, 'cancelled')], identity, now)).toBeNull();
    expect(buildPreviewMilestone([{ status: 'pending', paidAt: null, totalCents: 100_000 }], identity, now)).toBeNull();
    const many = Array.from({ length: 120 }, () => paid(9_000)); // 120 orders, $10,800
    expect(buildPreviewMilestone(many, identity, now)).toMatchObject({
      key: 'sales_10k',
      label: '$10,000 in sales',
      storeName: 'Preview Studio',
      handle: 'preview_studio',
      productImageUrl: 'https://img.test/tee.jpg',
    });
  });
});

describe('preview seen', () => {
  beforeEach(() => storage.clear());

  it('persists the seen key on this device', async () => {
    expect(await readPreviewSeen()).toBeNull();
    await writePreviewSeen('sales_10k');
    expect(await readPreviewSeen()).toBe('sales_10k');
  });
});

describe('formatReachedDate', () => {
  it('formats a short date and tolerates junk', () => {
    expect(formatReachedDate('2026-10-13T16:00:00Z')).toBe('Oct 13, 2026');
    expect(formatReachedDate('nope')).toBe('');
  });
});

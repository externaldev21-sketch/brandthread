import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import { findItem, searchItems } from './sellerControlCenter';

describe('Studio Activity item copy (audit)', () => {
  it('describes what /seller-activity shows — no orders or messages (those stay in Orders / Messages)', () => {
    const activity = findItem('activity');
    expect(activity?.description).toBeDefined();
    expect(activity!.description!.toLowerCase()).not.toMatch(/orders|messages/);
    expect(searchItems('orders').map((i) => i.id)).not.toContain('activity');
    expect(searchItems('likes').map((i) => i.id)).toContain('activity');
  });
});

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { seedDetailOnInteraction } from '../lib/seedDetailOnInteraction';

describe('detail cache seeding stays bounded and account-owned', () => {
  it('seeds just the tapped record from a large list, not every detail', () => {
    const client = new QueryClient();
    const rows = new Map(Array.from({ length: 400 }, (_, i) => [`${i}`, { id: `${i}` }]));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(seedDetailOnInteraction(client, ['order', 'owner', '2'], '2', { ownerId: 'owner', rows }, 'owner')).toBe(true);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(client.getQueryData(['order', 'owner', '2'])).toBe(rows.get('2'));
    client.clear();
  });

  it('does not emit another cache update for press-in followed by press', () => {
    const client = new QueryClient();
    const row = { id: '1' };
    const snapshot = { ownerId: 'owner', rows: new Map([['1', row]]) };
    const spy = vi.spyOn(client, 'setQueryData');
    seedDetailOnInteraction(client, ['order', 'owner', '1'], '1', snapshot, 'owner');
    seedDetailOnInteraction(client, ['order', 'owner', '1'], '1', snapshot, 'owner');
    expect(spy).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('cannot seed previous-account data after an account switch', () => {
    const client = new QueryClient();
    const snapshot = { ownerId: 'old-owner', rows: new Map([['1', { id: '1' }]]) };
    expect(seedDetailOnInteraction(client, ['order', 'new-owner', '1'], '1', snapshot, 'new-owner')).toBe(false);
    expect(seedDetailOnInteraction(client, ['order', 'new-owner', 'missing'], 'missing', snapshot, 'old-owner')).toBe(false);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.clear();
  });
});

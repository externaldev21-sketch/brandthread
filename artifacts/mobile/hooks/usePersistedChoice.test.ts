import { describe, expect, it } from 'vitest';
import { pickStoredChoice, storageKeyForChoice } from './usePersistedChoice';

describe('pickStoredChoice', () => {
  const allowed = ['all', 'shipped', 'delivered'] as const;
  it('restores a value that is still a valid choice', () => {
    expect(pickStoredChoice('shipped', allowed)).toBe('shipped');
  });
  it('ignores a value that is no longer offered', () => {
    expect(pickStoredChoice('archived', allowed)).toBeNull();
  });
  it('ignores an empty store', () => {
    expect(pickStoredChoice(null, allowed)).toBeNull();
  });
  it('namespaces keys', () => {
    expect(storageKeyForChoice('orders.filter')).toBe('bt.lastChoice.orders.filter');
  });
});

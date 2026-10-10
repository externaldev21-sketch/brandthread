import { describe, expect, it, vi } from 'vitest';
import { navigateOrShareStore, openShareStoreSheet, subscribeShareStoreSheet } from './shareStoreSheet';

describe('share store sheet bus', () => {
  it('opens the mounted sheet instead of pushing /share-store', () => {
    const open = vi.fn();
    const push = vi.fn();
    const off = subscribeShareStoreSheet(open);
    navigateOrShareStore('/share-store', push);
    expect(open).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    navigateOrShareStore('/buyer-search', push);
    expect(push).toHaveBeenCalledWith('/buyer-search');
    off();
  });
  it('falls back to the /share-store page when no sheet host is mounted', () => {
    const push = vi.fn();
    expect(openShareStoreSheet()).toBe(false);
    navigateOrShareStore('/share-store', push);
    expect(push).toHaveBeenCalledWith('/share-store');
  });
});

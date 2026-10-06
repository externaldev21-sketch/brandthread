import { describe, expect, it } from 'vitest';
import { storeHostFrom, storeSlugFrom, storeViewUrl } from '../storeAddress';

describe('store address', () => {
  it('never doubles the brandthread.app suffix (publish screen bug)', () => {
    // storeService stores the server slug as "<slug>.brandthread.app".
    expect(storeHostFrom('northline.brandthread.app')).toBe('northline.brandthread.app');
    expect(storeHostFrom('northline')).toBe('northline.brandthread.app');
    expect(storeHostFrom('https://Northline.brandthread.app/')).toBe('northline.brandthread.app');
  });

  it('falls back to a placeholder host only when there is no slug at all', () => {
    expect(storeHostFrom('')).toBe('yourstore.brandthread.app');
    expect(storeSlugFrom(undefined)).toBe('');
  });

  it('opens the store at a path that needs no DNS set up', () => {
    expect(storeViewUrl('northline.brandthread.app')).toBe('https://brandthread.app/s/northline');
    expect(storeViewUrl('')).toBeNull();
  });
});

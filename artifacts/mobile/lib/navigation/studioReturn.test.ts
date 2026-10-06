import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStudioReturnForTests,
  cancelStudioReturn,
  hasPendingStudioReturn,
  isSellerTabRootPath,
  markStudioTileOpened,
  shouldReopenStudioMenu,
} from './studioReturn';

describe('studioReturn', () => {
  beforeEach(() => __resetStudioReturnForTests());

  it('does nothing when no tile was opened from the menu', () => {
    expect(shouldReopenStudioMenu('/')).toBe(false);
    expect(shouldReopenStudioMenu('/manufacturer')).toBe(false);
    expect(shouldReopenStudioMenu('/')).toBe(false);
  });

  it('re-opens exactly once when the tile pops back to the underlying tab', () => {
    markStudioTileOpened('/');
    expect(shouldReopenStudioMenu('/')).toBe(false); // same render as the push
    expect(shouldReopenStudioMenu('/manufacturer')).toBe(false); // tile is up
    expect(shouldReopenStudioMenu('/')).toBe(true); // popped
    expect(hasPendingStudioReturn()).toBe(false);
    expect(shouldReopenStudioMenu('/')).toBe(false); // never twice
  });

  it('survives deeper pushes inside the tile and re-opens on the final pop', () => {
    markStudioTileOpened('/products');
    expect(shouldReopenStudioMenu('/design')).toBe(false);
    expect(shouldReopenStudioMenu('/design-canvas')).toBe(false);
    expect(shouldReopenStudioMenu('/design')).toBe(false);
    expect(shouldReopenStudioMenu('/products')).toBe(true);
  });

  it('clears instead of re-opening when the user lands on a different tab', () => {
    markStudioTileOpened('/');
    expect(shouldReopenStudioMenu('/manufacturer')).toBe(false);
    expect(shouldReopenStudioMenu('/orders')).toBe(false);
    expect(hasPendingStudioReturn()).toBe(false);
    expect(shouldReopenStudioMenu('/')).toBe(false);
  });

  it('is cancelled by an explicit tab-bar tap even onto the same tab', () => {
    markStudioTileOpened('/');
    expect(shouldReopenStudioMenu('/manufacturer')).toBe(false);
    cancelStudioReturn();
    expect(shouldReopenStudioMenu('/')).toBe(false);
  });

  it('records nothing for a tile that is itself a tab (switches tabs, nothing to pop)', () => {
    markStudioTileOpened('/', '/(tabs)/products');
    expect(hasPendingStudioReturn()).toBe(false);
    expect(shouldReopenStudioMenu('/products')).toBe(false);
    expect(shouldReopenStudioMenu('/')).toBe(false);
  });

  it('knows the seller tab roots', () => {
    for (const p of ['/', '/products', '/orders', '/profile']) expect(isSellerTabRootPath(p)).toBe(true);
    for (const p of ['/add-product', '/manufacturer', '/setup']) expect(isSellerTabRootPath(p)).toBe(false);
  });
});

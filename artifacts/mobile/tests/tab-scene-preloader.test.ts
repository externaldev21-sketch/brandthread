import { describe, expect, it } from 'vitest';
import { needsPreload } from '@/components/navigation/TabScenePreloader';

const state = (overrides: Record<string, unknown> = {}) => ({
  key: 'tabs', index: 0, type: 'tab', stale: false, routeNames: ['index', 'products', 'orders'],
  routes: [{ key: 'index-1', name: 'index' }, { key: 'products-1', name: 'products' }, { key: 'orders-1', name: 'orders' }],
  history: [{ type: 'route', key: 'index-1' }], preloadedRouteKeys: [] as string[],
  ...overrides,
}) as never;

describe('tab scene preloading', () => {
  it('pre-mounts only tabs that were never visited, focused or preloaded', () => {
    expect(needsPreload(state(), 'products')).toBe(true);
    expect(needsPreload(state(), 'index')).toBe(false); // focused
    expect(needsPreload(state({ history: [{ type: 'route', key: 'index-1' }, { type: 'route', key: 'products-1' }] }), 'products')).toBe(false); // visited: retained, PRELOAD would unfreeze it
    expect(needsPreload(state({ preloadedRouteKeys: ['orders-1'] }), 'orders')).toBe(false);
    expect(needsPreload(state(), 'missing')).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { leaveFlow, originRoute, readOrigin, withOrigin, ORIGIN_ROUTES } from './flowOrigin';

function makeRouter(canGoBack: boolean) {
  return { canGoBack: () => canGoBack, back: vi.fn(), replace: vi.fn() };
}

describe('withOrigin / readOrigin', () => {
  it('appends from=<origin> with the right separator', () => {
    expect(withOrigin('/add-product', 'dashboard')).toBe('/add-product?from=dashboard');
    expect(withOrigin('/add-product?intent=drop', 'products')).toBe('/add-product?intent=drop&from=products');
  });

  it('reads only known origins (array params take the first value)', () => {
    expect(readOrigin('dashboard')).toBe('dashboard');
    expect(readOrigin(['setup', 'x'])).toBe('setup');
    expect(readOrigin('seller-setup')).toBe('seller-setup');
    expect(readOrigin('menu')).toBeNull();
    expect(readOrigin(undefined)).toBeNull();
  });

  it('never resolves an origin to the Studio menu or a non-tab generic root', () => {
    for (const route of Object.values(ORIGIN_ROUTES)) {
      expect(route).not.toBe('/');
      expect(route).not.toMatch(/studio/);
    }
    expect(originRoute('products')).toBe('/(tabs)/products');
    expect(originRoute('orders')).toBe('/(tabs)/orders');
    expect(originRoute('profile')).toBe('/(tabs)/profile');
    expect(originRoute('setup')).toBe('/setup');
    expect(originRoute('seller-setup')).toBe('/(tabs)/');
    expect(originRoute('bogus')).toBeNull();
  });
});

describe('leaveFlow', () => {
  it('pops history whenever there is any, regardless of origin', () => {
    const router = makeRouter(true);
    leaveFlow(router, 'dashboard', '/(tabs)/' as never);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to the explicit origin when there is no history', () => {
    const router = makeRouter(false);
    leaveFlow(router, 'products', '/(tabs)/' as never);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/products');
  });

  it('uses the last-resort fallback only when no origin was passed', () => {
    const router = makeRouter(false);
    leaveFlow(router, undefined, '/(tabs)/more' as never);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/more');
  });
});

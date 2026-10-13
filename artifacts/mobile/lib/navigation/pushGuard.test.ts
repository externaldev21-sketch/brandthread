import { describe, expect, it, vi } from 'vitest';
import { createPushGuard, hrefKey, installPushGuard } from './pushGuard';

describe('hrefKey', () => {
  it('treats equal object hrefs with reordered params as the same', () => {
    expect(hrefKey({ pathname: '/p', params: { a: 1, b: 'x' } }))
      .toBe(hrefKey({ pathname: '/p', params: { b: 'x', a: 1 } }));
  });
  it('distinguishes different params', () => {
    expect(hrefKey({ pathname: '/p', params: { id: '1' } }))
      .not.toBe(hrefKey({ pathname: '/p', params: { id: '2' } }));
  });
});

describe('createPushGuard', () => {
  it('drops the same href inside the window and allows it after', () => {
    let t = 0;
    const allow = createPushGuard(600, () => t);
    expect(allow('/orders')).toBe(true);
    t = 100;
    expect(allow('/orders')).toBe(false);
    t = 800;
    expect(allow('/orders')).toBe(true);
  });
  it('never drops a different href', () => {
    let t = 0;
    const allow = createPushGuard(600, () => t);
    expect(allow('/a')).toBe(true);
    t = 10;
    expect(allow('/b')).toBe(true);
    t = 20;
    expect(allow('/a')).toBe(true);
  });
});

describe('installPushGuard', () => {
  it('wraps push and navigate once and leaves back/replace alone', () => {
    const push = vi.fn();
    const navigate = vi.fn();
    const back = vi.fn();
    const replace = vi.fn();
    const router = { push, navigate, back, replace };
    let t = 0;
    const allow = createPushGuard(600, () => t);
    installPushGuard(router, allow);
    installPushGuard(router, allow); // idempotent
    router.push('/x' as never);
    router.push('/x' as never);
    router.navigate('/y' as never);
    router.back();
    router.back();
    router.replace('/x');
    router.replace('/x');
    expect(push).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCarouselMemory, rememberSlide, rememberedSlide, subscribeSlide } from '../carouselMemory';

describe('carouselMemory subscriptions', () => {
  beforeEach(() => clearCarouselMemory());
  it('notifies subscribers of the canonical post, incl. loop copies', () => {
    const feed = vi.fn(); const loop = vi.fn(); const other = vi.fn();
    subscribeSlide('p1', feed); subscribeSlide('p1__loop2', loop); subscribeSlide('p2', other);
    rememberSlide('p1__loop3', 2);
    expect(feed).toHaveBeenCalledWith(2); expect(loop).toHaveBeenCalledWith(2); expect(other).not.toHaveBeenCalled();
    expect(rememberedSlide('p1', 5)).toBe(2);
  });
  it('does not emit duplicates for the same index', () => {
    const fn = vi.fn(); subscribeSlide('p1', fn);
    rememberSlide('p1', 1); rememberSlide('p1', 1); rememberSlide('p1__loop2', 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('unsubscribes', () => {
    const fn = vi.fn(); const off = subscribeSlide('p1', fn); off();
    rememberSlide('p1', 3); expect(fn).not.toHaveBeenCalled();
  });
});

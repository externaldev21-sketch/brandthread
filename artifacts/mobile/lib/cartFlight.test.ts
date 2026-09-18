import { describe, expect, it, vi } from 'vitest';
import {
  getCartFlightVector,
  getSuccessfulCartCount,
  measureCartTarget,
  shouldAnimateCartSuccess,
} from './cartFlight';

describe('cart flight', () => {
  it('waits for and uses the measured native cart center', async () => {
    const measure = vi.fn((callback: (x: number, y: number, width: number, height: number) => void) => {
      setTimeout(() => callback(320, 54, 44, 44), 5);
    });
    await expect(measureCartTarget(measure, { x: 340, y: 80 }, 50)).resolves.toEqual({
      x: 342,
      y: 76,
    });
  });

  it('uses a stable safe-area fallback when native measurement times out', async () => {
    vi.useFakeTimers();
    const promise = measureCartTarget(() => {}, { x: 340, y: 85 }, 120);
    await vi.advanceTimersByTimeAsync(120);
    await expect(promise).resolves.toEqual({ x: 340, y: 85 });
    vi.useRealTimers();
  });

  it('lands the thumbnail center on the measured cart center', () => {
    expect(getCartFlightVector(176, 500, { x: 342, y: 76 })).toEqual({
      x: 142,
      y: -448,
    });
  });

  it('only returns a badge count after a successful cart write', () => {
    expect(getSuccessfulCartCount({ success: false, cart: { items: [{ quantity: 9 }] } })).toBeNull();
    expect(getSuccessfulCartCount({
      success: true,
      cart: { items: [{ quantity: 2 }, { quantity: 3 }] },
    })).toBe(5);
  });

  it('disables success motion while preference is unresolved or reduced motion is on', () => {
    expect(shouldAnimateCartSuccess(null)).toBe(false);
    expect(shouldAnimateCartSuccess(true)).toBe(false);
    expect(shouldAnimateCartSuccess(false)).toBe(true);
  });
});
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/networkNotice';
import {
  JUST_SOLD_OUT_LABEL, isJustSoldOut, markJustSoldOut, resetJustSoldOut, soldOutFromError,
} from '@/lib/justSoldOut';

afterEach(() => resetJustSoldOut());

describe('soldOutFromError', () => {
  it('reads the server SOLD_OUT 409 every buy path returns', () => {
    const err = new ApiError(409, JSON.stringify({
      error: 'Logo Tee just sold out', code: 'SOLD_OUT', variantId: 'var-1', productName: 'Logo Tee',
    }));
    const info = soldOutFromError(err);
    expect(info).toMatchObject({ variantId: 'var-1', productName: 'Logo Tee' });
    expect(info?.message).toMatch(/^Logo Tee just sold out\./);
    expect(info?.message).toMatch(/haven’t been charged/);
  });

  it('ignores every other failure', () => {
    expect(soldOutFromError(new ApiError(409, JSON.stringify({ error: 'x', code: 'PAYMENT_PENDING' })))).toBeNull();
    expect(soldOutFromError(new ApiError(502, 'Bad gateway'))).toBeNull();
    expect(soldOutFromError(new Error('network'))).toBeNull();
  });
});

describe('just-sold-out marks', () => {
  it('flags only the claimed variant', () => {
    expect(JUST_SOLD_OUT_LABEL).toBe('Just sold out');
    markJustSoldOut('var-1');
    expect(isJustSoldOut('var-1')).toBe(true);
    expect(isJustSoldOut('var-2')).toBe(false);
    expect(isJustSoldOut(null)).toBe(false);
  });
});

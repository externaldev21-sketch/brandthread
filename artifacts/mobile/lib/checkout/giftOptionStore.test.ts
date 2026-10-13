import { afterEach, describe, expect, it } from 'vitest';
import {
  GIFT_MESSAGE_MAX, GIFT_NAME_MAX, getGiftOption, giftOptionBody, normalizeGiftOption, resetGiftOption, setGiftOption,
} from './giftOptionStore';

afterEach(() => resetGiftOption());

describe('giftOptionStore', () => {
  it('is not a gift until saved', () => {
    expect(getGiftOption()).toBeNull();
    expect(giftOptionBody()).toEqual({});
  });

  it('saves a trimmed gift and sends only the filled fields', () => {
    setGiftOption({ to: '  Sam Lee ', from: '', message: ' Happy birthday ' });
    expect(getGiftOption()).toEqual({ to: 'Sam Lee', from: '', message: 'Happy birthday' });
    expect(giftOptionBody()).toEqual({ gift: { to: 'Sam Lee', message: 'Happy birthday' } });
  });

  it('a gift with no note is still a gift', () => {
    setGiftOption({});
    expect(giftOptionBody()).toEqual({ gift: {} });
  });

  it('clears on reset', () => {
    setGiftOption({ to: 'Sam' });
    resetGiftOption();
    expect(getGiftOption()).toBeNull();
    expect(giftOptionBody()).toEqual({});
  });

  it('applies the limits', () => {
    const gift = normalizeGiftOption({ to: 'x'.repeat(80), from: 'y'.repeat(80), message: 'm'.repeat(400) });
    expect(gift.to).toHaveLength(GIFT_NAME_MAX);
    expect(gift.from).toHaveLength(GIFT_NAME_MAX);
    expect(gift.message).toHaveLength(GIFT_MESSAGE_MAX);
  });
});

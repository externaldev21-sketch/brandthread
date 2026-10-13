import { describe, expect, it } from 'vitest';
import { GIFT_CARD_CLAIM_URL, giftCardPurchaseIssue, giftCardTextBody, toE164 } from './giftCards';
import { smsComposeUrl } from './smsLink';

const info = { denominations: [2500, 5000], allowCustom: false, minCents: 500, maxCents: 100000 };

describe('gift card by text', () => {
  it('normalizes phones like the server', () => {
    expect(toE164('(415) 555-2671')).toBe('+14155552671');
    expect(toE164('1-415-555-2671')).toBe('+14155552671');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('555-2671')).toBeNull();
    expect(toE164('(015) 555-2671')).toBeNull();
  });

  it('checks the phone instead of the email when texting', () => {
    expect(giftCardPurchaseIssue({ amountCents: 2500, info, email: '', phone: '415 555' })).toContain('phone');
    expect(giftCardPurchaseIssue({ amountCents: 2500, info, email: '', phone: '4155552671' })).toBeNull();
    expect(giftCardPurchaseIssue({ amountCents: 2500, info, email: '' })).toContain('email');
  });

  it('writes the Messages note with the code and claim link', () => {
    expect(giftCardTextBody({ storeName: 'Atelier North', amountCents: 2500, code: 'ABCD' }))
      .toBe(`Here’s a $25 Atelier North gift card.\nCode: ABCD\nClaim it: ${GIFT_CARD_CLAIM_URL}`);
  });

  it('builds platform sms: URLs', () => {
    expect(smsComposeUrl('a b', 'ios')).toBe('sms:&body=a%20b');
    expect(smsComposeUrl('a b', 'android')).toBe('sms:?body=a%20b');
    expect(smsComposeUrl('hi', 'ios', '+14155552671')).toBe('sms:+14155552671&body=hi');
  });
});

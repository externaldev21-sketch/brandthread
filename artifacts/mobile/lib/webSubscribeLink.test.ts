import { describe, expect, it } from 'vitest';
import {
  WEB_PRICING_URL,
  isUsStorefront,
  isWebSubscribeFlagOn,
  parseWebCheckoutParams,
  shouldShowWebSubscribeLink,
  webPricingUrl,
} from './webSubscribeLink';

describe('Subscribe on the web link gating', () => {
  it('is off unless EXPO_PUBLIC_WEB_SUBSCRIBE_LINK is exactly 1', () => {
    expect(isWebSubscribeFlagOn(undefined)).toBe(false);
    expect(isWebSubscribeFlagOn('')).toBe(false);
    expect(isWebSubscribeFlagOn('true')).toBe(false);
    expect(isWebSubscribeFlagOn('0')).toBe(false);
    expect(isWebSubscribeFlagOn('1')).toBe(true);
  });

  it('recognises only the US storefront', () => {
    expect(isUsStorefront('USA')).toBe(true);
    expect(isUsStorefront('us')).toBe(true);
    expect(isUsStorefront('GBR')).toBe(false);
    expect(isUsStorefront('CAN')).toBe(false);
    expect(isUsStorefront(null)).toBe(false);
    expect(isUsStorefront(undefined)).toBe(false);
  });

  it('shows only on iOS, with the flag on, in the US storefront', () => {
    expect(shouldShowWebSubscribeLink({ platformOS: 'ios', flag: true, storefrontCountry: 'USA' })).toBe(true);
    expect(shouldShowWebSubscribeLink({ platformOS: 'ios', flag: false, storefrontCountry: 'USA' })).toBe(false);
    expect(shouldShowWebSubscribeLink({ platformOS: 'ios', flag: true, storefrontCountry: 'DEU' })).toBe(false);
    expect(shouldShowWebSubscribeLink({ platformOS: 'ios', flag: true, storefrontCountry: null })).toBe(false);
    expect(shouldShowWebSubscribeLink({ platformOS: 'android', flag: true, storefrontCountry: 'USA' })).toBe(false);
    expect(shouldShowWebSubscribeLink({ platformOS: 'web', flag: true, storefrontCountry: 'USA' })).toBe(false);
  });

  it('opens the public pricing page', () => {
    expect(WEB_PRICING_URL).toBe('https://brandthread.app/pricing');
    expect(webPricingUrl()).toBe('https://brandthread.app/pricing?utm_source=ios_app');
  });
});

describe('parseWebCheckoutParams', () => {
  it('accepts a known plan with monthly or annual billing', () => {
    expect(parseWebCheckoutParams('growth', 'annual')).toEqual({ planId: 'growth', billing: 'annual' });
    expect(parseWebCheckoutParams('pro', undefined)).toEqual({ planId: 'pro', billing: 'monthly' });
    expect(parseWebCheckoutParams(['starter'], ['monthly'])).toEqual({ planId: 'starter', billing: 'monthly' });
  });

  it('rejects anything else', () => {
    expect(parseWebCheckoutParams('scale', 'annual')).toBeNull();
    expect(parseWebCheckoutParams(undefined, 'annual')).toBeNull();
    expect(parseWebCheckoutParams('growth', 'weekly')).toBeNull();
  });
});

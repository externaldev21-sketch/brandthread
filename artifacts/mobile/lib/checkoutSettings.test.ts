import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELLER_CHECKOUT_SETTINGS, checkoutModeOption, nextCheckoutMode, sellerCheckoutSettingsFrom, storeLanguageName,
} from './checkoutSettings';

describe('seller checkout settings', () => {
  it('reads saved settings with safe defaults', () => {
    expect(sellerCheckoutSettingsFrom(undefined)).toEqual(DEFAULT_SELLER_CHECKOUT_SETTINGS);
    expect(sellerCheckoutSettingsFrom({ checkoutMode: 'accounts_required', tippingEnabled: true, storeLanguage: 'fr' }))
      .toEqual({ checkoutMode: 'accounts_required', tippingEnabled: true, storeLanguage: 'fr' });
    expect(sellerCheckoutSettingsFrom({ checkoutMode: 'checkout_only', tippingEnabled: 'yes', storeLanguage: '' }))
      .toEqual(DEFAULT_SELLER_CHECKOUT_SETTINGS);
  });

  it('cycles through the three enforced checkout modes', () => {
    expect(nextCheckoutMode('guest_only')).toBe('accounts_optional');
    expect(nextCheckoutMode('accounts_optional')).toBe('accounts_required');
    expect(nextCheckoutMode('accounts_required')).toBe('guest_only');
    expect(checkoutModeOption('accounts_required').label).toBe('Accounts required');
    expect(checkoutModeOption('guest_only').label).toBe('Guest checkout only');
    expect(sellerCheckoutSettingsFrom({ checkoutMode: 'guest_only' }).checkoutMode).toBe('guest_only');
  });

  it('names the store language', () => {
    expect(storeLanguageName('en')).toBe('English');
    expect(storeLanguageName('ja')).toBe('Japanese');
    expect(storeLanguageName('xx')).toBe('XX');
  });
});

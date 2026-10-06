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

  it('switches between the two enforced checkout modes', () => {
    expect(nextCheckoutMode('accounts_optional')).toBe('accounts_required');
    expect(nextCheckoutMode('accounts_required')).toBe('accounts_optional');
    expect(checkoutModeOption('accounts_required').label).toBe('Accounts required');
  });

  it('names the store language', () => {
    expect(storeLanguageName('en')).toBe('English');
    expect(storeLanguageName('ja')).toBe('Japanese');
    expect(storeLanguageName('xx')).toBe('XX');
  });
});

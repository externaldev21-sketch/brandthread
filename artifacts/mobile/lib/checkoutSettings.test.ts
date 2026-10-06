import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELLER_CHECKOUT_SETTINGS, checkoutAccountSwitchesFor, checkoutModeForSwitch, checkoutModeOption, nextCheckoutMode, sellerCheckoutSettingsFrom, storeLanguageName,
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

  it('shows the checkout mode as the Store Settings account switches', () => {
    expect(checkoutAccountSwitchesFor('accounts_required')).toEqual({ requireAccount: true, guestCheckout: false });
    expect(checkoutAccountSwitchesFor('accounts_optional')).toEqual({ requireAccount: false, guestCheckout: true });
    expect(checkoutAccountSwitchesFor('guest_only')).toEqual({ requireAccount: false, guestCheckout: true });
  });

  it('maps a flipped account switch to the mode it saves', () => {
    for (const mode of ['guest_only', 'accounts_optional', 'accounts_required'] as const) {
      expect(checkoutModeForSwitch(mode, { requireAccount: true })).toBe('accounts_required');
      expect(checkoutModeForSwitch(mode, { guestCheckout: false })).toBe('accounts_required');
    }
    expect(checkoutModeForSwitch('accounts_required', { requireAccount: false })).toBe('accounts_optional');
    expect(checkoutModeForSwitch('accounts_required', { guestCheckout: true })).toBe('accounts_optional');
    expect(checkoutModeForSwitch('guest_only', { requireAccount: false })).toBe('guest_only');
    expect(checkoutModeForSwitch('guest_only', { guestCheckout: true })).toBe('guest_only');
    expect(checkoutModeForSwitch('accounts_optional', { guestCheckout: true })).toBe('accounts_optional');
  });

  it('keeps the two switches consistent with each other after any flip', () => {
    for (const mode of ['guest_only', 'accounts_optional', 'accounts_required'] as const) {
      for (const change of [{ requireAccount: true }, { requireAccount: false }, { guestCheckout: true }, { guestCheckout: false }]) {
        const next = checkoutAccountSwitchesFor(checkoutModeForSwitch(mode, change));
        expect(next.requireAccount).toBe(!next.guestCheckout);
        if ('requireAccount' in change) expect(next.requireAccount).toBe(change.requireAccount);
        else expect(next.guestCheckout).toBe(change.guestCheckout);
      }
    }
  });
});

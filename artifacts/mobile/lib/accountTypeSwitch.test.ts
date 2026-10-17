import { describe, expect, it, vi } from 'vitest';

import {
  SWITCH_AGE_RESTRICTED_MESSAGE,
  accountTypeSwitchErrorMessage,
  destinationAfterSwitch,
  emitAccountRoleChanged,
  needsSellerSetup,
  onAccountRoleChanged,
} from './accountTypeSwitch';
import { ApiError } from './networkNotice';

describe('needsSellerSetup', () => {
  it('requires both a brand name and a brand stage', () => {
    expect(needsSellerSetup(null)).toBe(true);
    expect(needsSellerSetup({ brandName: 'Acme', brandStage: null })).toBe(true);
    expect(needsSellerSetup({ brandName: '   ', brandStage: 'idea' })).toBe(true);
    expect(needsSellerSetup({ brandName: 'Acme', brandStage: 'idea' })).toBe(false);
  });
});

describe('destinationAfterSwitch', () => {
  it('routes buyers to the buyer home', () => {
    expect(destinationAfterSwitch('buyer')).toEqual({ home: '/(buyer)/', next: null });
  });
  it('routes a just-set-up seller into the store setup checklist', () => {
    expect(destinationAfterSwitch('seller', { completedSellerSetupNow: true })).toEqual({ home: '/(tabs)/', next: '/setup' });
    expect(destinationAfterSwitch('seller')).toEqual({ home: '/(tabs)/', next: null });
  });
});

describe('accountTypeSwitchErrorMessage', () => {
  it('explains the server age gate', () => {
    const err = new ApiError(403, JSON.stringify({ error: 'You must be 18 or older…', code: 'AGE_RESTRICTED' }));
    expect(accountTypeSwitchErrorMessage(err)).toBe(SWITCH_AGE_RESTRICTED_MESSAGE);
  });
  it('surfaces a readable server message', () => {
    const err = new ApiError(400, JSON.stringify({ error: 'brandName required' }));
    expect(accountTypeSwitchErrorMessage(err)).toBe('brandName required');
  });
  it('falls back for opaque failures', () => {
    expect(accountTypeSwitchErrorMessage(new ApiError(502, '<html>bad gateway</html>'))).toMatch(/Could not update/);
    expect(accountTypeSwitchErrorMessage(undefined)).toMatch(/Could not update/);
    expect(accountTypeSwitchErrorMessage(new ApiError(408, '{}'))).toMatch(/timed out/);
  });
});

describe('role-change bus', () => {
  it('notifies subscribers until they unsubscribe', () => {
    const fn = vi.fn();
    const off = onAccountRoleChanged(fn);
    emitAccountRoleChanged('seller');
    off();
    emitAccountRoleChanged('buyer');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('seller');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_ACCOUNTS, MAX_ACCOUNTS_MESSAGE, getHandle, getDisplayName, resolveAccountTypeLabel, isAtAccountCap,
} from '@/lib/accountSwitcherHelpers';

describe('account switcher: handle/name resolution', () => {
  it('prefers the server-synced username over Clerk\'s own username field', () => {
    expect(getHandle({ username: 'clerk_handle' }, 'server_handle')).toBe('@server_handle');
  });

  it('falls back to Clerk\'s username when the server has none yet', () => {
    expect(getHandle({ username: 'clerk_handle' }, null)).toBe('@clerk_handle');
  });

  it('falls back to the email local-part when no username exists anywhere', () => {
    expect(getHandle({ primaryEmailAddress: { emailAddress: 'ava@brand.com' } })).toBe('@ava');
  });

  it('falls back to a generic placeholder when nothing is known', () => {
    expect(getHandle({})).toBe('@you');
  });

  it('prefers the server display name over Clerk first/last name', () => {
    expect(getDisplayName({ firstName: 'Ava', lastName: 'Reyes' }, 'Atelier Noire')).toBe('Atelier Noire');
  });

  it('falls back to Clerk first/last name when the server has none', () => {
    expect(getDisplayName({ firstName: 'Ava', lastName: 'Reyes' })).toBe('Ava Reyes');
  });

  it('falls back to username, then a generic placeholder', () => {
    expect(getDisplayName({ username: 'ava' })).toBe('ava');
    expect(getDisplayName({})).toBe('Your account');
  });
});

describe('account switcher: per-row Buyer/Seller label', () => {
  it('trusts the live local role for the active session, not the server lookup', () => {
    expect(resolveAccountTypeLabel(true, 'seller', 'buyer')).toBe('Seller');
    expect(resolveAccountTypeLabel(true, 'buyer', 'seller')).toBe('Buyer');
  });

  it('uses the server accountType for every other (inactive) session', () => {
    expect(resolveAccountTypeLabel(false, 'buyer', 'seller')).toBe('Seller');
    expect(resolveAccountTypeLabel(false, 'seller', 'buyer')).toBe('Buyer');
  });

  it('defaults to Buyer when nothing is known yet (server lookup still in flight)', () => {
    expect(resolveAccountTypeLabel(false, null, undefined)).toBe('Buyer');
  });
});

describe('account switcher: 8-account cap', () => {
  it('is exactly 8, matching Dev\'s "up to 8 accounts" rule', () => {
    expect(MAX_ACCOUNTS).toBe(8);
  });

  it('flags exactly at and above the cap, not below it', () => {
    expect(isAtAccountCap(7)).toBe(false);
    expect(isAtAccountCap(8)).toBe(true);
    expect(isAtAccountCap(9)).toBe(true);
  });

  it('carries Dev\'s exact "Add account" message text', () => {
    expect(MAX_ACCOUNTS_MESSAGE).toBe(
      'You can be logged into up to 8 accounts. Log out of one to add another.',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url).pathname, 'utf8');

describe('onboarding account boundary', () => {
  it('does not offer guest access from the sign-in/account-creation sequence', () => {
    const signIn = read('../app/sign-in.tsx');
    expect(signIn).not.toContain('Continue as guest');
    expect(signIn).not.toContain('guestBtn');
    expect(signIn).toContain('Create an account');
  });

  it('keeps guest checkout available at the purchase boundary', () => {
    const checkout = read('../app/buyer-checkout.tsx');
    const storeSettings = read('../app/store-settings.tsx');
    expect(checkout).toContain('Guest Checkout');
    expect(storeSettings).toContain('Allow guest checkout');
  });
});
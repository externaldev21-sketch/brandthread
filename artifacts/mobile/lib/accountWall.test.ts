import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const path = (p: string) => new URL(p, import.meta.url).pathname;
const read = (p: string) => readFileSync(path(p), 'utf8');

describe('account wall: no guest browsing', () => {
  it('offers no guest entry on the welcome or sign-in screens', () => {
    const welcome = read('../components/onboarding/WelcomeStep.tsx');
    const onboarding = read('../app/onboarding.tsx');
    const signIn = read('../app/sign-in.tsx');
    for (const src of [welcome, onboarding, signIn]) {
      expect(src).not.toContain('Browse as a guest');
      expect(src).not.toContain('onBrowse');
    }
    expect(welcome).not.toContain('onboarding-welcome-browse-guest');
    expect(signIn).not.toContain('browse-as-guest-button');
  });

  it('AuthGate sends every signed-out protected route to the auth flow and remembers it', () => {
    const layout = read('../app/_layout.tsx');
    expect(layout).not.toContain('isGuestBrowseRoute');
    expect(layout).not.toContain('isGuestAllowedRoute');
    expect(layout).toContain('if (!isSignedIn && inProtectedArea) {');
    expect(layout).toContain('pendingReturnRef.current = safeReturnTo(');
    expect(layout).toContain("router.replace('/onboarding');");
    expect(read('./guestRoutes.ts')).toContain('return false;');
  });

  it('keeps the bt_preview bypass ahead of the signed-out redirect', () => {
    const layout = read('../app/_layout.tsx');
    const bypass = layout.indexOf('const devRole = PREVIEW_ROLE ?? webPreviewRole ?? DEV_BYPASS_ROLE;');
    const wall = layout.indexOf('if (!isSignedIn && inProtectedArea) {');
    expect(bypass).toBeGreaterThan(-1);
    expect(wall).toBeGreaterThan(bypass);
  });

  it('removes the inline guest sign-in gates and prompts', () => {
    // Keep defensive guards used by newer optimistic-action logic; they now
    // route expired sessions to Welcome instead of creating a guest sheet.
    expect(read('../hooks/useSignInGate.ts')).not.toContain('requestGuestSignIn');
    expect(existsSync(path('../components/GuestSignInSheet.tsx'))).toBe(false);
    for (const file of [
      '../app/(tabs)/feed.tsx', '../app/seller-profile.tsx', '../app/buyer-product-detail.tsx',
      '../app/hashtag/[tag].tsx', '../app/product-questions.tsx', '../components/products/LaunchCountdown.tsx',
      '../components/SaveHeartHost.tsx', '../components/checkout/OrderConfirmation.tsx', '../app/buyer-post-comments.tsx',
      '../app/u/[username].tsx', './saved/savedProducts.ts',
    ]) {
      const src = read(file);
      expect(src, file).not.toContain('guest-inline-sign-in');
    }
    expect(read('../app/u/[username].tsx')).not.toContain('PublicProfileLanding');
    expect(read('./saved/savedProducts.ts')).not.toContain('Sign in to save items');
    expect(read('../app/buyer-post-comments.tsx')).not.toContain('to join the conversation');
    expect(read('../app/buyer-drop-detail.tsx')).not.toContain('Sign in to get drop alerts');
    expect(read('../components/checkout/OrderConfirmation.tsx')).not.toContain('checkout-create-account');
  });
});

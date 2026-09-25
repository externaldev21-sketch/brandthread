import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * app/_layout.tsx is the app shell (query client, every context provider,
 * notifications, RevenueCat, …) and isn't feasibly mountable in a unit test
 * (see the same rationale in tests/onboarding-flow-e2e.test.tsx's
 * `@/app/_layout` mock comment). This is a source-level regression guard,
 * matching the pattern already used by tests/preview-seller-bypass.test.ts,
 * for the sign-out -> device-scoped-state-cleanup fix: `onboarding_pending_flow`
 * and `onboarding_pending_username` (see app/onboarding.tsx) are device-scoped,
 * not per-account, so a half-finished sign-up from the account that just
 * signed out must not bleed into the next person's fresh sign-up on the same
 * phone/Expo Go install.
 */
const layoutSource = readFileSync(path.resolve(__dirname, '../app/_layout.tsx'), 'utf8');

describe('sign-out clears device-scoped onboarding-in-progress state', () => {
  it('removes the pending flow/username flags in the isSignedIn true -> false transition effect', () => {
    const transitionBlock = layoutSource.slice(
      layoutSource.indexOf('// Transition: was signed-in, now signed-out'),
      layoutSource.indexOf('// Pending team invite'),
    );
    expect(transitionBlock).toContain("AsyncStorage.multiRemove(['onboarding_pending_flow', 'onboarding_pending_username'])");
  });
});

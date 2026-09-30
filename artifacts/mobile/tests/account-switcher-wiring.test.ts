import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(resolve(import.meta.dirname, '../components/AccountSwitcherSheet.tsx'), 'utf8');

/**
 * Structural checks for the account switcher's multi-account wiring — a full
 * mount needs a heavy @clerk/expo + expo-router + BottomSheet mock (see
 * tests/onboarding-flow-e2e.test.tsx for how large that gets for a different
 * screen); the pure per-row logic itself is unit-tested directly in
 * tests/accountSwitcherHelpers.test.ts. This locks in that the component
 * actually wires those helpers/APIs in rather than reverting to the old
 * hardcoded behavior.
 */
describe('AccountSwitcherSheet wiring', () => {
  it('sources every row\'s Buyer/Seller label through the shared resolver, not a hardcoded default', () => {
    expect(screen).toContain('resolveAccountTypeLabel(isActive, role, info?.accountType)');
    // The old bug: every inactive session was hardcoded to "Buyer".
    expect(screen).not.toMatch(/isActive\s*\?\s*\([^)]*\)\s*:\s*'Buyer'/);
  });

  it('fetches real accountType/username/avatar for every signed-in session from the server', () => {
    expect(screen).toContain('api.auth.accountTypes(ids)');
  });

  it('enforces the shared MAX_ACCOUNTS cap before opening "Add account"', () => {
    expect(screen).toContain('isAtAccountCap(activeSessions.length)');
    expect(screen).toContain('if (atCap)');
    expect(screen).toContain('MAX_ACCOUNTS_MESSAGE');
  });

  it('logs a single account out via Clerk\'s per-session signOut, not the whole-device sign-out', () => {
    expect(screen).toContain('clerk.signOut({ sessionId: account.id })');
  });

  it('counts only this device\'s real, active Clerk sessions', () => {
    expect(screen).toContain("session.status === 'active' && session.user");
  });
});

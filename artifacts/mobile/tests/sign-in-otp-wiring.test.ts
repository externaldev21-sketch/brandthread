import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(resolve(import.meta.dirname, '../app/sign-in.tsx'), 'utf8');

/**
 * Structural checks for the TikTok-style email/phone + one-time-code sign-in
 * flow. A full mount needs a heavy @clerk/expo mock (see
 * tests/onboarding-flow-e2e.test.tsx for how large that gets for a sibling
 * screen); the pure identifier-detection logic is unit-tested directly in
 * tests/signInIdentifier.test.ts. This locks in that the screen actually
 * wires Clerk's real emailCode/phoneCode strategies rather than a stub.
 */
describe('sign-in OTP wiring', () => {
  it('sends a real Clerk email or phone code depending on the identifier', () => {
    expect(screen).toContain('signIn.emailCode.sendCode({ emailAddress: identifier.trim().toLowerCase() })');
    expect(screen).toContain('signIn.phoneCode.sendCode({ phoneNumber: normalizePhoneNumber(identifier) })');
  });

  it('verifies the code against the matching real Clerk strategy', () => {
    expect(screen).toContain('signIn.emailCode.verifyCode({ code: value })');
    expect(screen).toContain('signIn.phoneCode.verifyCode({ code: value })');
  });

  it('gracefully disables phone instead of crashing when Clerk reports it unsupported', () => {
    expect(screen).toContain('isPhoneStrategyUnsupportedError(err)');
    expect(screen).toContain('setPhoneSupported(false)');
    // The identifier field must actually react to that state, not just set it.
    expect(screen).toContain("phoneSupported ? 'Email or phone number' : 'Email address'");
  });

  it('keeps password as an alternative, not the only path', () => {
    expect(screen).toContain("label=\"Use password instead\"");
    expect(screen).toContain('signIn.password({ identifier: identifier.trim(), password })');
  });

  it('keeps forgot-password untouched (still its own route, not folded into this flow)', () => {
    expect(screen).toContain("router.push('/forgot-password' as never)");
  });

  it('uses the shared OtpCodeInput (auto-advance/paste) for code entry, not a raw digit TextInput', () => {
    expect(screen).toContain('import { OtpCodeInput }');
    expect(screen).toContain('<OtpCodeInput');
  });

  it('has a resend timer that actually gates the resend action', () => {
    expect(screen).toContain('RESEND_COOLDOWN_SECONDS');
    expect(screen).toContain('resendSeconds > 0 || sendingCode');
  });
});

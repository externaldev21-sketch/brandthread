import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isClerkKeyInvalid, mapClerkError } from './clerkErrors';

describe('clerk errors', () => {
  it('recognises clerk_key_invalid from our API and from Clerk', () => {
    expect(isClerkKeyInvalid({ code: 'clerk_key_invalid' })).toBe(true);
    expect(isClerkKeyInvalid({ errors: [{ code: 'clerk_key_invalid' }] })).toBe(true);
    expect(isClerkKeyInvalid({ message: '401 clerk_key_invalid' })).toBe(true);
    expect(isClerkKeyInvalid({ code: 'form_code_incorrect' })).toBe(false);
    expect(isClerkKeyInvalid(null)).toBe(false);
  });

  it('gives users a real reason, never the key', () => {
    expect(mapClerkError({ errors: [{ code: 'clerk_key_invalid' }] })).toMatch(/server setup problem/);
    expect(mapClerkError({ errors: [{ code: 'form_code_incorrect' }] })).toBe('That code isn’t right. Check your email and try again.');
    expect(mapClerkError({ errors: [{ code: 'form_identifier_exists' }] })).toMatch(/Log in instead/);
    expect(mapClerkError({ errors: [{ code: 'something_new', longMessage: 'Clerk says why.' }] })).toBe('Clerk says why.');
  });

  it('the Clerk key banner is development-only and reads the server status', () => {
    const banner = readFileSync(path.resolve(__dirname, '../../components/onboarding/launch/ClerkKeyBanner.tsx'), 'utf8');
    expect(banner).toContain("if (!__DEV__ || !(invalid || forceInvalid)) return null;");
    expect(banner).toContain("serviceRequest<ClerkStatus>('/api/public/clerk-status'");
    expect(banner).not.toMatch(/sk_(test|live)_[A-Za-z0-9]{6,}/);
  });
});

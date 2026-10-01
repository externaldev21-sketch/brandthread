import { describe, expect, it } from 'vitest';
import {
  formatHandleCooldown,
  mapSecurityError,
  normalizePhoneForClerk,
  validatePasswordChange,
} from './accountSecurityErrors';

const clerkError = (code: string) => ({ errors: [{ code, message: code }] });

describe('mapSecurityError (password change)', () => {
  it('maps a wrong current password', () => {
    expect(mapSecurityError(clerkError('form_password_incorrect'), 'password').kind).toBe('wrong_password');
  });
  it('maps weak and breached passwords', () => {
    expect(mapSecurityError(clerkError('form_password_length_too_short'), 'password').kind).toBe('weak_password');
    expect(mapSecurityError(clerkError('form_password_not_strong_enough'), 'password').kind).toBe('weak_password');
    expect(mapSecurityError(clerkError('form_password_pwned'), 'password').kind).toBe('breached_password');
  });
  it('maps the reverification requirement and a dismissed prompt', () => {
    expect(mapSecurityError(clerkError('session_reverification_required'), 'password').kind).toBe('reverification');
    expect(mapSecurityError({ code: 'reverification_cancelled' }, 'password').kind).toBe('cancelled');
  });
  it('maps rate limiting and lockouts', () => {
    expect(mapSecurityError(clerkError('too_many_requests'), 'password').kind).toBe('rate_limited');
    expect(mapSecurityError(clerkError('user_locked'), 'password').kind).toBe('locked');
  });
  it('falls back to generic copy that names the context and never leaks raw messages', () => {
    const mapped = mapSecurityError(new Error('boom: internal detail'), 'password');
    expect(mapped.kind).toBe('unknown');
    expect(mapped.message).toBe("Couldn't change your password. Try again.");
    expect(mapSecurityError(new Error('Network request failed'), 'password').kind).toBe('network');
  });
  it('maps email / phone identifier errors', () => {
    expect(mapSecurityError(clerkError('form_identifier_exists'), 'email').message).toContain('email address');
    expect(mapSecurityError(clerkError('form_identifier_exists'), 'phone').message).toContain('phone number');
    expect(mapSecurityError(clerkError('form_code_incorrect'), 'code').kind).toBe('wrong_code');
    expect(mapSecurityError(clerkError('verification_expired'), 'code').kind).toBe('expired_code');
  });
});

describe('validatePasswordChange', () => {
  const ok = { current: 'old-password', next: 'new-password-1', confirm: 'new-password-1', requireCurrent: true };
  it('accepts a valid change', () => {
    expect(validatePasswordChange(ok)).toBeNull();
  });
  it('requires the current password only when one exists', () => {
    expect(validatePasswordChange({ ...ok, current: '' })).toBe('Enter your current password.');
    expect(validatePasswordChange({ ...ok, current: '', requireCurrent: false })).toBeNull();
  });
  it('enforces length, mismatch and reuse', () => {
    expect(validatePasswordChange({ ...ok, next: 'short', confirm: 'short' })).toBe('Use at least 8 characters.');
    expect(validatePasswordChange({ ...ok, confirm: 'different-one' })).toBe('Passwords do not match.');
    expect(validatePasswordChange({ ...ok, next: 'old-password', confirm: 'old-password' })).toMatch(/not used/);
  });
});

describe('normalizePhoneForClerk', () => {
  it('normalises US numbers and keeps explicit country codes', () => {
    expect(normalizePhoneForClerk('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhoneForClerk('1 555 123 4567')).toBe('+15551234567');
    expect(normalizePhoneForClerk('+44 7911 123456')).toBe('+447911123456');
  });
  it('rejects ambiguous or too-short input', () => {
    expect(normalizePhoneForClerk('12345')).toBeNull();
    expect(normalizePhoneForClerk('07911123456')).toBeNull();
    expect(normalizePhoneForClerk('')).toBeNull();
  });
});

describe('formatHandleCooldown', () => {
  it('counts whole days remaining', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(formatHandleCooldown('2026-10-10T12:00:00Z', now)).toContain('(10 days)');
    expect(formatHandleCooldown('2026-10-01T00:00:00Z', now)).toContain('(1 day)');
  });
});

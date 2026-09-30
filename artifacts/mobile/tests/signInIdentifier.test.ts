import { describe, expect, it } from 'vitest';
import { detectIdentifierKind, normalizePhoneNumber, isPhoneStrategyUnsupportedError } from '@/lib/signInIdentifier';

describe('detectIdentifierKind', () => {
  it('recognizes a well-formed email address', () => {
    expect(detectIdentifierKind('ava@brand.com')).toBe('email');
    expect(detectIdentifierKind('  Ava.Reyes+tag@Brand.co.uk  ')).toBe('email');
  });

  it('rejects a malformed email address', () => {
    expect(detectIdentifierKind('ava@')).toBe('invalid');
    expect(detectIdentifierKind('ava@brand')).toBe('invalid');
    expect(detectIdentifierKind('@brand.com')).toBe('invalid');
  });

  it('recognizes a phone number in various formats', () => {
    expect(detectIdentifierKind('+1 (555) 123-4567')).toBe('phone');
    expect(detectIdentifierKind('5551234567')).toBe('phone');
    expect(detectIdentifierKind('+442071234567')).toBe('phone');
  });

  it('rejects too-short digit strings as neither email nor a real phone number', () => {
    expect(detectIdentifierKind('12345')).toBe('invalid');
  });

  it('rejects empty/whitespace-only input', () => {
    expect(detectIdentifierKind('')).toBe('invalid');
    expect(detectIdentifierKind('   ')).toBe('invalid');
  });

  it('does not misclassify a username (no @, not phone-shaped) as email or phone', () => {
    expect(detectIdentifierKind('gallerydesires')).toBe('invalid');
  });
});

describe('normalizePhoneNumber', () => {
  it('strips visual separators, keeping only digits', () => {
    expect(normalizePhoneNumber('(555) 123-4567')).toBe('5551234567');
  });

  it('preserves a leading +', () => {
    expect(normalizePhoneNumber('+1 555 123 4567')).toBe('+15551234567');
  });
});

describe('isPhoneStrategyUnsupportedError', () => {
  it('recognizes the strategy_for_user_invalid error code', () => {
    expect(isPhoneStrategyUnsupportedError({ code: 'strategy_for_user_invalid' })).toBe(true);
  });

  it('recognizes a message mentioning phone + not enabled/disabled/unsupported', () => {
    expect(isPhoneStrategyUnsupportedError({ message: 'Phone number sign-in is not enabled for this application.' })).toBe(true);
    expect(isPhoneStrategyUnsupportedError({ longMessage: 'Phone authentication is disabled.' })).toBe(true);
  });

  it('does not flag an unrelated error as phone-unsupported', () => {
    expect(isPhoneStrategyUnsupportedError({ code: 'form_code_incorrect', message: 'Invalid code.' })).toBe(false);
    expect(isPhoneStrategyUnsupportedError({ code: 'request_rate_limited' })).toBe(false);
  });

  it('handles a missing/null error gracefully', () => {
    expect(isPhoneStrategyUnsupportedError(null)).toBe(false);
    expect(isPhoneStrategyUnsupportedError(undefined)).toBe(false);
  });
});

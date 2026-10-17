import { describe, expect, it } from 'vitest';
import { canFinishTwoFactorSetup, describeTwoFactorError, extractBackupCodes, formatBackupCodesForShare } from '../twoFactorSetup';

describe('extractBackupCodes', () => {
  it('reads backupCodes from a verified TOTP resource', () => {
    expect(extractBackupCodes({ backupCodes: ['aaaa-1111', 'bbbb-2222'] })).toEqual(['aaaa-1111', 'bbbb-2222']);
  });

  it('reads codes from a BackupCode resource', () => {
    expect(extractBackupCodes({ codes: ['x1', 'x2'] })).toEqual(['x1', 'x2']);
  });

  it('drops blanks, non-strings and duplicates', () => {
    expect(extractBackupCodes({ backupCodes: [' a ', '', 'a', 3, null, 'b'] })).toEqual(['a', 'b']);
  });

  it('returns [] for missing or malformed input', () => {
    expect(extractBackupCodes(undefined)).toEqual([]);
    expect(extractBackupCodes({ backupCodes: undefined })).toEqual([]);
    expect(extractBackupCodes({ secret: 's', uri: 'otpauth://' })).toEqual([]);
  });
});

describe('formatBackupCodesForShare', () => {
  it('puts one code per line after a header', () => {
    const text = formatBackupCodesForShare(['a', 'b']);
    expect(text.split('\n').slice(-2)).toEqual(['a', 'b']);
    expect(text).toMatch(/^Brandthread backup codes/);
  });
});

describe('canFinishTwoFactorSetup', () => {
  it('requires both codes and acknowledgement', () => {
    expect(canFinishTwoFactorSetup({ codes: [], acknowledged: true })).toBe(false);
    expect(canFinishTwoFactorSetup({ codes: ['a'], acknowledged: false })).toBe(false);
    expect(canFinishTwoFactorSetup({ codes: ['a'], acknowledged: true })).toBe(true);
  });
});

describe('describeTwoFactorError', () => {
  it('uses shared copy for known Clerk codes', () => {
    expect(describeTwoFactorError({ errors: [{ code: 'form_code_incorrect' }] }, 'code')).toBe("That code isn't right. Try again.");
  });
  it('surfaces the real Clerk long message for unknown codes', () => {
    expect(describeTwoFactorError({ errors: [{ code: 'feature_not_enabled', longMessage: 'Backup codes are not enabled.', message: 'x' }] }))
      .toBe('Backup codes are not enabled.');
  });
  it('falls back to Error.message, then generic copy', () => {
    expect(describeTwoFactorError(new Error('boom'))).toBe('boom');
    expect(describeTwoFactorError(undefined)).toMatch(/Try again/);
  });
});

/**
 * Pure unit tests for shareProfile helpers.
 * No native modules, safe to run in Vitest node environment.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeUsername,
  buildCanonicalProfileUrl,
  isValidNormalizedUsername,
  BRANDTHREAD_ORIGIN,
} from '../shareProfile';

describe('BRANDTHREAD_ORIGIN', () => {
  it('is the exact production origin', () => {
    expect(BRANDTHREAD_ORIGIN).toBe('https://brandthread.app');
  });
});

describe('normalizeUsername', () => {
  it('returns null for null/undefined/empty', () => {
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername(undefined)).toBeNull();
    expect(normalizeUsername('')).toBeNull();
  });

  it('lowercases the input', () => {
    expect(normalizeUsername('JaneDoe')).toBe('janedoe');
  });

  it('strips non-[a-z0-9_] characters', () => {
    expect(normalizeUsername('jane.doe!')).toBe('janedoe');
    expect(normalizeUsername('jane-doe@test')).toBe('janedoetest');
    expect(normalizeUsername('hello world')).toBe('helloworld');
  });

  it('returns null when result is shorter than 3 chars', () => {
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('a!')).toBeNull();
  });

  it('returns null when result is longer than 30 chars', () => {
    const long = 'a'.repeat(31);
    expect(normalizeUsername(long)).toBeNull();
  });

  it('accepts exactly 3 chars', () => {
    expect(normalizeUsername('abc')).toBe('abc');
  });

  it('accepts exactly 30 chars', () => {
    const thirty = 'a'.repeat(30);
    expect(normalizeUsername(thirty)).toBe(thirty);
  });

  it('allows underscores', () => {
    expect(normalizeUsername('jane_doe')).toBe('jane_doe');
  });

  it('strips leading/trailing whitespace before normalizing', () => {
    expect(normalizeUsername('  jane  ')).toBe('jane');
  });
});

describe('buildCanonicalProfileUrl', () => {
  it('returns the exact canonical URL for a valid username', () => {
    expect(buildCanonicalProfileUrl('janedoe')).toBe('https://brandthread.app/u/janedoe');
  });

  it('normalizes the username in the URL', () => {
    expect(buildCanonicalProfileUrl('JaneDoe')).toBe('https://brandthread.app/u/janedoe');
  });

  it('returns null for null/undefined', () => {
    expect(buildCanonicalProfileUrl(null)).toBeNull();
    expect(buildCanonicalProfileUrl(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(buildCanonicalProfileUrl('')).toBeNull();
  });

  it('returns null when username normalizes to fewer than 3 chars', () => {
    expect(buildCanonicalProfileUrl('a!')).toBeNull();
  });

  it('returns null when username normalizes to more than 30 chars', () => {
    expect(buildCanonicalProfileUrl('a'.repeat(31))).toBeNull();
  });

  it('never uses a fallback or guessed slug', () => {
    // A brand name that would be a tempting fallback — must return null.
    const result = buildCanonicalProfileUrl(null);
    expect(result).toBeNull();
  });

  it('produces a URL with exactly the right structure', () => {
    const url = buildCanonicalProfileUrl('test_user');
    expect(url).toBe('https://brandthread.app/u/test_user');
    expect(url).not.toContain('/u/me');
    expect(url).not.toContain('replit');
  });

  it('strips special chars from username before building URL', () => {
    // e.g. an email-style username — strips the @-sign and domain.
    const url = buildCanonicalProfileUrl('user@example');
    expect(url).toBe('https://brandthread.app/u/userexample');
  });
});

describe('isValidNormalizedUsername', () => {
  it('accepts valid lowercase alphanumeric + underscore', () => {
    expect(isValidNormalizedUsername('jane_doe')).toBe(true);
    expect(isValidNormalizedUsername('abc')).toBe(true);
    expect(isValidNormalizedUsername('a'.repeat(30))).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(isValidNormalizedUsername('JaneDoe')).toBe(false);
  });

  it('rejects special chars', () => {
    expect(isValidNormalizedUsername('jane.doe')).toBe(false);
    expect(isValidNormalizedUsername('jane-doe')).toBe(false);
  });

  it('rejects too short', () => {
    expect(isValidNormalizedUsername('ab')).toBe(false);
  });

  it('rejects too long', () => {
    expect(isValidNormalizedUsername('a'.repeat(31))).toBe(false);
  });
});

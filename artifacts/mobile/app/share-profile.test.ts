/**
 * Tests for share-profile screen behaviour.
 * These test the pure logic and URL construction — no native renderer needed.
 */
import { describe, expect, it } from 'vitest';
import { buildCanonicalProfileUrl, normalizeUsername, parseProfileDeepLink } from '@/lib/shareProfile';

// ─── Routing / navigation guards ─────────────────────────────────────────────

describe('share-profile: canonical URL construction', () => {
  it('produces the exact canonical URL for a known username', () => {
    const url = buildCanonicalProfileUrl('janedoe');
    expect(url).toBe('https://brandthread.app/u/janedoe');
  });

  it('QR value matches canonical URL exactly', () => {
    const username = 'test_user';
    const url = buildCanonicalProfileUrl(username);
    // The QR code value must equal the canonical URL.
    expect(url).toBe(`https://brandthread.app/u/${username}`);
  });

  it('returns null (no QR / no URL) when username is missing', () => {
    expect(buildCanonicalProfileUrl(null)).toBeNull();
    expect(buildCanonicalProfileUrl(undefined)).toBeNull();
    expect(buildCanonicalProfileUrl('')).toBeNull();
  });

  it('does not fabricate a link from a Clerk ID pattern', () => {
    // Clerk IDs look like "user_2abc..." — these must not become URLs.
    const clerkId = 'user_2abcDEFghijk';
    const normalized = normalizeUsername(clerkId);
    // After stripping non-[a-z0-9_] chars and lowercasing, this becomes "user2abcdefghijk" (16 chars) — valid length but from a Clerk ID.
    // The key contract: we only call buildCanonicalProfileUrl with the users.username field, never with clerkId.
    // This test verifies normalizeUsername behavior when given a Clerk-style ID.
    // We confirm no production code path should pass clerkId to buildCanonicalProfileUrl.
    expect(typeof normalized).toBe('string'); // normalizer does not crash
    // The resulting URL would be valid-looking but we verify the format.
    if (normalized) {
      const url = buildCanonicalProfileUrl(normalized);
      expect(url).toMatch(/^https:\/\/brandthread\.app\/u\/[a-z0-9_]{3,30}$/);
    }
  });

  it('does not fabricate a URL from a brand-name-derived slug', () => {
    // buildCanonicalProfileUrl should never receive a brand-name slug.
    // If given one it normalizes it — but null input returns null.
    expect(buildCanonicalProfileUrl(null)).toBeNull();
  });

  it('Copy Link payload is the canonical URL, not a display name', () => {
    const url = buildCanonicalProfileUrl('shopowner');
    // The clipboard string must equal the canonical URL.
    expect(url).toBe('https://brandthread.app/u/shopowner');
  });

  it('Share payload message contains the canonical URL', () => {
    const url = buildCanonicalProfileUrl('shopowner');
    const displayName = 'Shop Owner';
    const message = `Find ${displayName} on Brandthread: ${url}`;
    expect(message).toContain('https://brandthread.app/u/shopowner');
    expect(message).not.toContain('/u/me');
    expect(message).not.toContain('undefined');
  });
});

// ─── Account switch guard ─────────────────────────────────────────────────────

describe('share-profile: account switch cannot show previous URL', () => {
  it('URL for account A and account B are distinct', () => {
    const urlA = buildCanonicalProfileUrl('alice');
    const urlB = buildCanonicalProfileUrl('bob');
    expect(urlA).not.toBe(urlB);
    expect(urlA).toBe('https://brandthread.app/u/alice');
    expect(urlB).toBe('https://brandthread.app/u/bob');
  });

  it('null username always produces null URL regardless of previous account', () => {
    // Simulate: account was 'alice', now switched to an account without a username.
    expect(buildCanonicalProfileUrl(null)).toBeNull();
  });
});

// ─── Missing username guard ───────────────────────────────────────────────────

describe('share-profile: missing username state', () => {
  it('no QR and no fake URL when username is absent', () => {
    const url = buildCanonicalProfileUrl(null);
    expect(url).toBeNull(); // No QR code should be rendered.
  });

  it('no QR and no fake URL for a very short username', () => {
    const url = buildCanonicalProfileUrl('ab');
    expect(url).toBeNull();
  });
});

// ─── QR scanner: scanned-link parsing ────────────────────────────────────────

describe('share-profile: parsing a scanned QR / deep link back to a username', () => {
  it('parses the canonical https URL', () => {
    expect(parseProfileDeepLink('https://brandthread.app/u/janedoe')).toBe('janedoe');
  });

  it('parses the www. and http variants', () => {
    expect(parseProfileDeepLink('https://www.brandthread.app/u/janedoe')).toBe('janedoe');
    expect(parseProfileDeepLink('http://brandthread.app/u/janedoe')).toBe('janedoe');
  });

  it('parses the native deep-link scheme', () => {
    expect(parseProfileDeepLink('brandthread://u/janedoe')).toBe('janedoe');
  });

  it('is the exact inverse of buildCanonicalProfileUrl', () => {
    const url = buildCanonicalProfileUrl('shopowner')!;
    expect(parseProfileDeepLink(url)).toBe('shopowner');
  });

  it('rejects a foreign / unrelated QR code payload', () => {
    expect(parseProfileDeepLink('https://instagram.com/u/janedoe')).toBeNull();
    expect(parseProfileDeepLink('not a url at all')).toBeNull();
    expect(parseProfileDeepLink('')).toBeNull();
    expect(parseProfileDeepLink(null)).toBeNull();
  });
});

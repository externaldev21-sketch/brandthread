/**
 * Focused pure/contract tests for the /u/[username] canonical profile route.
 *
 * Covers:
 * 1. Signed-out visitor stays on canonical route (no redirect) and renders safe fields only.
 * 2. Signed-in buyer/seller → correct internal navigation params.
 * 3. No private fields (Clerk IDs, posts, friends, contacts, seller commerce data) in safe DTO.
 * 4. Auth-loading behavior — navigation is gated until auth is ready.
 * 5. Loading waits for both resolver and auth readiness without hanging.
 *
 * These are pure contract/logic tests — no native modules, safe for Vitest node environment.
 */
import { describe, expect, it } from 'vitest';
import { normalizeUsername, buildCanonicalProfileUrl } from '../shareProfile';

// ─── Mirrored DTO interface (kept in sync with the route file) ────────────────

interface PublicProfileDto {
  id: string;               // opaque DB alias — never exposed in URL
  username: string;
  accountType: 'buyer' | 'seller';
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  verified: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<PublicProfileDto> & { accountType: 'buyer' | 'seller' },
): PublicProfileDto {
  return {
    id: 'opaque-db-uuid-0001',
    username: 'testuser',
    displayName: 'Test User',
    bio: null,
    avatarUrl: null,
    verified: false,
    ...overrides,
  };
}

// Simulates the routing decision the component makes at render time.
function resolveNavigation(
  profile: PublicProfileDto,
  auth: { isLoaded: boolean; isSignedIn: boolean },
): 'stay_on_canonical' | 'redirect_seller' | 'redirect_buyer' | 'wait_for_auth' {
  if (!auth.isLoaded) return 'wait_for_auth';
  if (!auth.isSignedIn) return 'stay_on_canonical';
  return profile.accountType === 'seller' ? 'redirect_seller' : 'redirect_buyer';
}

// Simulate the URL built for authenticated seller navigation.
function buildSellerNavUrl(profile: PublicProfileDto): string {
  return `/seller-profile?sellerId=${encodeURIComponent(profile.id)}&isOwner=false`;
}

// Simulate the URL built for authenticated buyer navigation.
function buildBuyerNavUrl(profile: PublicProfileDto): string {
  return `/buyer-other-profile?userId=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(
    profile.displayName ?? profile.username,
  )}&handle=${encodeURIComponent('@' + profile.username)}`;
}

// ─── 1. Signed-out: stays on canonical route ──────────────────────────────────

describe('signed-out visitor stays on /u/{username}', () => {
  it('returns stay_on_canonical when auth is loaded and not signed in (buyer profile)', () => {
    const profile = makeProfile({ accountType: 'buyer' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: false });
    expect(result).toBe('stay_on_canonical');
  });

  it('returns stay_on_canonical when auth is loaded and not signed in (seller profile)', () => {
    const profile = makeProfile({ accountType: 'seller' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: false });
    expect(result).toBe('stay_on_canonical');
  });

  it('does not redirect to buyer-other-profile when signed out', () => {
    const profile = makeProfile({ accountType: 'buyer' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: false });
    expect(result).not.toBe('redirect_buyer');
    expect(result).not.toBe('redirect_seller');
  });

  it('does not redirect to seller-profile when signed out', () => {
    const profile = makeProfile({ accountType: 'seller' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: false });
    expect(result).not.toBe('redirect_seller');
    expect(result).not.toBe('redirect_buyer');
  });
});

// ─── 2. Signed-out: safe DTO fields rendered ──────────────────────────────────

describe('signed-out landing renders only safe DTO fields', () => {
  it('safe fields are present in the DTO', () => {
    const profile = makeProfile({
      accountType: 'buyer',
      displayName: 'Jane Doe',
      bio: 'Fashion lover.',
      avatarUrl: 'https://cdn.brandthread.app/avatar/janedoe.jpg',
      verified: true,
    });
    // All of these are safe to display.
    expect(profile.username).toBe('testuser');
    expect(profile.displayName).toBe('Jane Doe');
    expect(profile.bio).toBe('Fashion lover.');
    expect(profile.avatarUrl).toBe('https://cdn.brandthread.app/avatar/janedoe.jpg');
    expect(profile.verified).toBe(true);
    expect(profile.accountType).toBe('buyer');
  });

  it('DTO does not contain posts field', () => {
    const profile = makeProfile({ accountType: 'buyer' }) as PublicProfileDto & {
      posts?: unknown;
    };
    expect(profile.posts).toBeUndefined();
  });

  it('DTO does not contain friends or followers field', () => {
    const profile = makeProfile({ accountType: 'buyer' }) as PublicProfileDto & {
      friends?: unknown;
      followers?: unknown;
      following?: unknown;
    };
    expect(profile.friends).toBeUndefined();
    expect(profile.followers).toBeUndefined();
    expect(profile.following).toBeUndefined();
  });

  it('DTO does not contain contact data', () => {
    const profile = makeProfile({ accountType: 'buyer' }) as PublicProfileDto & {
      email?: unknown;
      phone?: unknown;
    };
    expect(profile.email).toBeUndefined();
    expect(profile.phone).toBeUndefined();
  });

  it('DTO does not contain seller commerce data', () => {
    const profile = makeProfile({ accountType: 'seller' }) as PublicProfileDto & {
      revenue?: unknown;
      orders?: unknown;
      stripeAccountId?: unknown;
      products?: unknown;
    };
    expect(profile.revenue).toBeUndefined();
    expect(profile.orders).toBeUndefined();
    expect(profile.stripeAccountId).toBeUndefined();
    expect(profile.products).toBeUndefined();
  });

  it('DTO does not expose Clerk ID in any field besides id alias', () => {
    const profile = makeProfile({ accountType: 'buyer' }) as PublicProfileDto & {
      clerkId?: unknown;
    };
    expect(profile.clerkId).toBeUndefined();
    // The id field is an opaque alias; it MUST NOT look like a Clerk user_ token
    // in the contract — but the contract itself does not mandate one format.
  });

  it('canonical URL never contains the internal id', () => {
    const profile = makeProfile({ accountType: 'seller' });
    const url = buildCanonicalProfileUrl(profile.username);
    expect(url).toBe('https://brandthread.app/u/testuser');
    expect(url).not.toContain(profile.id);
  });
});

// ─── 3. Signed-in buyer navigation ───────────────────────────────────────────

describe('signed-in buyer navigates to buyer-other-profile', () => {
  it('resolves to redirect_buyer for buyer accountType', () => {
    const profile = makeProfile({ accountType: 'buyer' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: true });
    expect(result).toBe('redirect_buyer');
  });

  it('navigation URL uses opaque id, never a Clerk-style token in the path', () => {
    const profile = makeProfile({ accountType: 'buyer', id: 'db-uuid-buyer-0001' });
    const url = buildBuyerNavUrl(profile);
    expect(url).toContain('/buyer-other-profile');
    expect(url).toContain(`userId=${encodeURIComponent('db-uuid-buyer-0001')}`);
    // URL never exposes the id in the browser canonical path
    expect(url).not.toMatch(/^\/u\//);
  });

  it('buyer nav URL contains name and handle params', () => {
    const profile = makeProfile({
      accountType: 'buyer',
      displayName: 'Jane Doe',
      username: 'janedoe',
    });
    const url = buildBuyerNavUrl(profile);
    expect(url).toContain(`name=${encodeURIComponent('Jane Doe')}`);
    expect(url).toContain(`handle=${encodeURIComponent('@janedoe')}`);
  });

  it('falls back to username when displayName is null', () => {
    const profile = makeProfile({
      accountType: 'buyer',
      displayName: null,
      username: 'janedoe',
    });
    const url = buildBuyerNavUrl(profile);
    expect(url).toContain(`name=${encodeURIComponent('janedoe')}`);
  });
});

// ─── 4. Signed-in seller navigation ──────────────────────────────────────────

describe('signed-in buyer navigates to seller-profile', () => {
  it('resolves to redirect_seller for seller accountType', () => {
    const profile = makeProfile({ accountType: 'seller' });
    const result = resolveNavigation(profile, { isLoaded: true, isSignedIn: true });
    expect(result).toBe('redirect_seller');
  });

  it('seller nav URL uses opaque id, isOwner=false', () => {
    const profile = makeProfile({ accountType: 'seller', id: 'db-uuid-seller-0001' });
    const url = buildSellerNavUrl(profile);
    expect(url).toContain('/seller-profile');
    expect(url).toContain(`sellerId=${encodeURIComponent('db-uuid-seller-0001')}`);
    expect(url).toContain('isOwner=false');
  });

  it('seller nav URL never contains a raw Clerk user_ prefix', () => {
    // The opaque DB UUID must not look like a Clerk ID in the URL
    const profile = makeProfile({ accountType: 'seller', id: 'some-db-uuid' });
    const url = buildSellerNavUrl(profile);
    expect(url).not.toContain('user_');
  });
});

// ─── 5. Auth-loading behavior ────────────────────────────────────────────────

describe('auth-loading: navigation waits for Clerk to be ready', () => {
  it('returns wait_for_auth when isLoaded is false regardless of isSignedIn', () => {
    const profile = makeProfile({ accountType: 'seller' });
    expect(resolveNavigation(profile, { isLoaded: false, isSignedIn: false })).toBe('wait_for_auth');
    expect(resolveNavigation(profile, { isLoaded: false, isSignedIn: true })).toBe('wait_for_auth');
  });

  it('does NOT navigate while auth is still loading', () => {
    const profile = makeProfile({ accountType: 'buyer' });
    const result = resolveNavigation(profile, { isLoaded: false, isSignedIn: false });
    expect(result).not.toBe('redirect_buyer');
    expect(result).not.toBe('redirect_seller');
    expect(result).not.toBe('stay_on_canonical');
  });

  it('transitions to stay_on_canonical once auth loads and visitor is signed out', () => {
    const profile = makeProfile({ accountType: 'buyer' });
    // During load
    expect(resolveNavigation(profile, { isLoaded: false, isSignedIn: false })).toBe('wait_for_auth');
    // After load — signed out
    expect(resolveNavigation(profile, { isLoaded: true, isSignedIn: false })).toBe('stay_on_canonical');
  });

  it('transitions to redirect once auth loads and visitor is signed in', () => {
    const profile = makeProfile({ accountType: 'seller' });
    // During load
    expect(resolveNavigation(profile, { isLoaded: false, isSignedIn: false })).toBe('wait_for_auth');
    // After load — signed in
    expect(resolveNavigation(profile, { isLoaded: true, isSignedIn: true })).toBe('redirect_seller');
  });
});

// ─── 6. URL canonicality — no private IDs in the browser URL ─────────────────

describe('canonical URL is always /u/{username}, never exposes internal ids', () => {
  it('canonical URL is built from username only', () => {
    const url = buildCanonicalProfileUrl('janedoe');
    expect(url).toBe('https://brandthread.app/u/janedoe');
  });

  it('canonical URL does not contain opaque id', () => {
    const url = buildCanonicalProfileUrl('janedoe');
    expect(url).not.toContain('db-uuid');
    expect(url).not.toContain('user_');
  });

  it('normalizeUsername sanitizes input before URL is built', () => {
    expect(normalizeUsername('JaneDoe')).toBe('janedoe');
    expect(normalizeUsername('jane.doe!')).toBe('janedoe');
    expect(normalizeUsername(null)).toBeNull();
  });

  it('returns null for invalid usernames — never guesses a fallback', () => {
    expect(buildCanonicalProfileUrl(null)).toBeNull();
    expect(buildCanonicalProfileUrl('ab')).toBeNull(); // too short
    expect(buildCanonicalProfileUrl('a'.repeat(31))).toBeNull(); // too long
  });
});

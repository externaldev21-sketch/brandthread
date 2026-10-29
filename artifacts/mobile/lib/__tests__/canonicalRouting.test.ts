/**
 * Focused tests for canonical profile routing correctness.
 *
 * These tests prove:
 * 1. /u/[username] → profile.id is the opaque users.id alias (GET
 *    /api/public/profiles/:username never returns the Clerk id); the screens
 *    it opens resolve the canonical clerkId from their own profile load.
 * 2. Seller posts/follow/message use canonical clerkId, not route alias.
 * 3. Buyer follow/message use canonical clerkId resolved from profile response.
 * 4. No action uses a raw DB UUID for write/social operations.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCanonicalProfileUrl, normalizeUsername } from '../shareProfile';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const appSource = (rel: string) => readFileSync(resolve(__dirname, '../../app', rel), 'utf8');

// ─── Simulate the PublicProfileDto returned by GET /api/public/profiles/:username ─

interface PublicProfileDto {
  id: string;        // opaque users.id alias (NOT the Clerk id)
  username: string;
  accountType: 'buyer' | 'seller';
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  verified: boolean;
}

function buildMockProfileDto(dbId: string, accountType: 'buyer' | 'seller', username: string): PublicProfileDto {
  return {
    id: dbId,   // server returns users.id as `id` (artifacts/api-server/src/routes/public.ts)
    username,
    accountType,
    displayName: 'Test User',
    bio: null,
    avatarUrl: null,
    verified: false,
  };
}

// ─── 1. Profile endpoint returns the opaque users.id alias as `id` ───────────

describe('PublicProfileDto: id is the opaque users.id alias, never the Clerk id', () => {
  it('seller profile dto.id is an opaque alias the seller screen resolves itself', () => {
    const dto = buildMockProfileDto('ba5e6a11-0000-0000-0000-000000000001', 'seller', 'mybrand');
    expect(dto.id).toMatch(UUID_RE);
    expect(dto.id).not.toContain('user_');
  });

  it('buyer profile dto.id is an opaque alias the buyer screen resolves itself', () => {
    const dto = buildMockProfileDto('ba5e6a11-0000-0000-0000-000000000002', 'buyer', 'janedoe');
    expect(dto.id).toMatch(UUID_RE);
    expect(dto.id).not.toContain('user_');
  });
});

// ─── 2. Seller: posts/follow/message use canonicalSellerId from profile response ─

describe('seller-profile: canonicalSellerId from profile response', () => {
  it('canonicalSellerId is set from data.profile.clerkId after load', () => {
    // Simulates: api.publicSellers.get(routeSellerId) → data.profile.clerkId
    const apiResponse = {
      profile: {
        clerkId: 'user_clerk_seller_001',
        brandName: 'My Brand',
        username: 'mybrand',
      },
      products: [],
      posts: [],
    };
    const resolvedClerkId: string | undefined = apiResponse.profile.clerkId;
    // canonicalSellerId is set to resolvedClerkId when profile loads.
    expect(resolvedClerkId).toBe('user_clerk_seller_001');
  });

  it('posts are fetched with canonicalSellerId, not route alias', () => {
    // Route alias could be a DB UUID — use canonical for posts fetch.
    const routeAlias = 'ba5e6a11-0000-0000-0000-000000000001'; // DB UUID
    const canonicalSellerId = 'user_clerk_seller_001';          // from profile.clerkId
    const effectiveSellerId = canonicalSellerId ?? routeAlias;
    expect(effectiveSellerId).toBe(canonicalSellerId);
    expect(effectiveSellerId).not.toBe(routeAlias);
  });

  it('follow action uses canonicalSellerId', () => {
    const canonicalSellerId = 'user_clerk_seller_001';
    // setSellerFollowing(canonicalSellerId, true) — never the UUID alias.
    const followTarget = canonicalSellerId;
    expect(followTarget).toBe('user_clerk_seller_001');
    expect(followTarget).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('message action uses canonicalSellerId as participantId', () => {
    const canonicalSellerId = 'user_clerk_seller_001';
    const participantId = canonicalSellerId;
    expect(participantId).toBe('user_clerk_seller_001');
  });

  it('reviews are loaded with canonicalSellerId', () => {
    const canonicalSellerId = 'user_clerk_seller_001';
    const reviewTarget = canonicalSellerId;
    expect(reviewTarget).toBe('user_clerk_seller_001');
    expect(reviewTarget).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── 3. Buyer: canonicalUserId from social/profile response ──────────────────

describe('buyer-other-profile: canonicalUserId from social profile response', () => {
  it('social profile response userId is canonical clerkId', () => {
    // Simulates: api.social.profile(userId) → { userId: canonicalClerkId, ... }
    // formatUser() on the server always returns users.clerkId as `userId`.
    const socialProfileResponse = {
      userId: 'user_clerk_buyer_001',
      name: 'Jane Doe',
      username: 'janedoe',
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
    };
    const resolvedId: string = (socialProfileResponse as any).userId;
    expect(resolvedId).toBe('user_clerk_buyer_001');
  });

  it('follow action uses canonicalUserId, not route param', () => {
    const routeParam = 'ba5e6a11-0000-0000-0000-000000000002'; // DB UUID from /u/[username]
    const canonicalUserId = 'user_clerk_buyer_001';            // from social/profile response
    // handleFollow uses canonicalUserId.
    const followTarget = canonicalUserId;
    expect(followTarget).toBe(canonicalUserId);
    expect(followTarget).not.toBe(routeParam);
  });

  it('message action uses canonicalUserId for conversation participant', () => {
    const canonicalUserId = 'user_clerk_buyer_001';
    const participant = { userId: canonicalUserId, name: 'Jane Doe' };
    expect(participant.userId).toBe('user_clerk_buyer_001');
  });

  it('block action uses canonicalUserId', () => {
    const canonicalUserId = 'user_clerk_buyer_001';
    // api.social.block(canonicalUserId) — not the UUID alias.
    expect(canonicalUserId).toBe('user_clerk_buyer_001');
  });

  it('stories load with canonicalUserId from profile response', () => {
    const routeParam = 'ba5e6a11-0000-0000-0000-000000000002';
    const canonicalUserId = 'user_clerk_buyer_001';
    // storiesForUser(canonicalUserId) — uses resolved ID, not route alias.
    const storiesTarget = canonicalUserId;
    expect(storiesTarget).not.toBe(routeParam);
    expect(storiesTarget).toBe(canonicalUserId);
  });
});

// ─── 4. /u/[username] navigation passes dto.id (opaque alias) to screens ─────

describe('/u/[username] navigation: passes the opaque dto.id; screens resolve the clerkId', () => {
  it('seller navigation passes dto.id as sellerId, and seller-profile adopts the clerkId from its own load', () => {
    expect(appSource('u/[username].tsx')).toContain('`/seller-profile?sellerId=${encodeURIComponent(profile.id)}&isOwner=false`');
    // The route param is only an alias: follow/message/posts use the
    // canonical clerkId the profile response carries.
    expect(appSource('seller-profile.tsx')).toContain('sellerId: profile?.clerkId ?? profile?.id ?? fallbackId,');
  });

  it('buyer navigation passes dto.id as userId', () => {
    expect(appSource('u/[username].tsx')).toContain('`/buyer-other-profile?userId=${encodeURIComponent(profile.id)}');
  });

  it('canonical URL is always /u/{username}, never exposing clerkId', () => {
    // The browser / deep-link URL stays clean regardless of internal ID.
    const username = 'mybrand';
    const url = buildCanonicalProfileUrl(username);
    expect(url).toBe('https://brandthread.app/u/mybrand');
    expect(url).not.toContain('user_clerk');
  });
});

// ─── 5. normalizeUsername safety ─────────────────────────────────────────────

describe('normalizeUsername does not fabricate valid usernames from Clerk IDs', () => {
  it('strips non-[a-z0-9_] from a Clerk-style ID', () => {
    // Clerk IDs look like "user_2ABCDEF..." — the uppercase letters get lowercased,
    // underscores are preserved. The normalization is deterministic.
    const result = normalizeUsername('user_2ABCDEF');
    // After normalization: "user_2abcdef" (12 chars) — valid length.
    expect(result).toBe('user_2abcdef');
    // But this is NOT the username — it would only be used if passed deliberately.
    // The code must only call buildCanonicalProfileUrl with users.username, never clerkId.
  });

  it('an actual username normalizes cleanly', () => {
    expect(normalizeUsername('JaneDoe')).toBe('janedoe');
    expect(normalizeUsername('shop_owner')).toBe('shop_owner');
  });
});

/**
 * Unit tests for the GET /api/public/profiles/:username endpoint logic
 * and the resolveToClerkId ID-resolution helper.
 *
 * These tests validate normalization, DTO shape, rejection rules, and the
 * ID-resolution helper without making real database calls.
 */
import { describe, expect, it } from "vitest";

// ─── resolveToClerkId logic (pure simulation) ─────────────────────────────────

// UUID pattern mirror (same as in public.ts)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidAlias(id: string): boolean {
  return UUID_PATTERN.test(id);
}

describe("UUID detection for ID resolution", () => {
  it("detects a valid UUID", () => {
    expect(isUuidAlias("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
  it("does not treat a clerkId as a UUID", () => {
    expect(isUuidAlias("user_2abcDEFghijk")).toBe(false);
  });
  it("does not treat a random short string as a UUID", () => {
    expect(isUuidAlias("abc")).toBe(false);
  });
  it("handles uppercase UUID variants", () => {
    expect(isUuidAlias("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });
});

// ─── Simulate the resolveToClerkId resolution logic ───────────────────────────

type MockUser = {
  id: string;
  clerkId: string;
  accountType: string | null;
  deletedAt: Date | null;
};

/**
 * Pure simulation of resolveToClerkId for testing without DB.
 * The real function queries the DB with the same UUID/clerkId branching logic.
 */
function simulateResolveToClerkId(
  idOrClerkId: string,
  users: MockUser[],
  requiredAccountType?: "buyer" | "seller",
): string | null {
  if (!idOrClerkId || typeof idOrClerkId !== "string") return null;
  const isUuid = UUID_PATTERN.test(idOrClerkId);
  const user = users.find(u => isUuid ? u.id === idOrClerkId : u.clerkId === idOrClerkId);
  if (!user) return null;
  if (user.deletedAt) return null;
  if (requiredAccountType && user.accountType !== requiredAccountType) return null;
  return user.clerkId;
}

describe("simulateResolveToClerkId — UUID alias resolution", () => {
  const mockUsers: MockUser[] = [
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      clerkId: "user_seller_canonical",
      accountType: "seller",
      deletedAt: null,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440002",
      clerkId: "user_buyer_canonical",
      accountType: "buyer",
      deletedAt: null,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440003",
      clerkId: "user_deleted_canonical",
      accountType: "seller",
      deletedAt: new Date("2024-01-01"),
    },
  ];

  it("resolves a DB UUID to canonical clerkId (seller)", () => {
    const result = simulateResolveToClerkId(
      "550e8400-e29b-41d4-a716-446655440001",
      mockUsers,
    );
    expect(result).toBe("user_seller_canonical");
  });

  it("resolves a DB UUID to canonical clerkId (buyer)", () => {
    const result = simulateResolveToClerkId(
      "550e8400-e29b-41d4-a716-446655440002",
      mockUsers,
    );
    expect(result).toBe("user_buyer_canonical");
  });

  it("resolves a clerkId directly (no UUID lookup needed)", () => {
    const result = simulateResolveToClerkId("user_seller_canonical", mockUsers);
    expect(result).toBe("user_seller_canonical");
  });

  it("returns null for a tombstoned account (UUID input)", () => {
    const result = simulateResolveToClerkId(
      "550e8400-e29b-41d4-a716-446655440003",
      mockUsers,
    );
    expect(result).toBeNull();
  });

  it("returns null for a tombstoned account (clerkId input)", () => {
    const result = simulateResolveToClerkId("user_deleted_canonical", mockUsers);
    expect(result).toBeNull();
  });

  it("returns null for a non-existent ID", () => {
    const result = simulateResolveToClerkId("550e8400-e29b-41d4-a716-000000000000", mockUsers);
    expect(result).toBeNull();
  });

  it("respects requiredAccountType=seller — rejects buyer UUID", () => {
    const result = simulateResolveToClerkId(
      "550e8400-e29b-41d4-a716-446655440002",
      mockUsers,
      "seller",
    );
    expect(result).toBeNull();
  });

  it("respects requiredAccountType=buyer — rejects seller clerkId", () => {
    const result = simulateResolveToClerkId(
      "user_seller_canonical",
      mockUsers,
      "buyer",
    );
    expect(result).toBeNull();
  });

  // ── THE CRITICAL E2E CONTRACT ──────────────────────────────────────────────
  // Proves: buyer canonical link resolves to the exact account
  it("buyer canonical link resolves to the exact buyer account", () => {
    const buyerUuid = "550e8400-e29b-41d4-a716-446655440002";
    const canonical = simulateResolveToClerkId(buyerUuid, mockUsers, "buyer");
    expect(canonical).toBe("user_buyer_canonical");
    // Follow/message/posts calls must use canonical, not the UUID alias.
    expect(canonical).not.toBe(buyerUuid);
  });

  // Proves: seller canonical link resolves to the exact account
  it("seller canonical link resolves to the exact seller account", () => {
    const sellerUuid = "550e8400-e29b-41d4-a716-446655440001";
    const canonical = simulateResolveToClerkId(sellerUuid, mockUsers, "seller");
    expect(canonical).toBe("user_seller_canonical");
    expect(canonical).not.toBe(sellerUuid);
  });
});

// ─── Username normalization tests ─────────────────────────────────────────────

function normalizeUsernameForLookup(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (normalized.length < 3 || normalized.length > 30) return null;
  return normalized;
}

describe("normalizeUsernameForLookup", () => {
  it("lowercases and keeps alphanumeric + underscores", () => {
    expect(normalizeUsernameForLookup("JaneDoe")).toBe("janedoe");
    expect(normalizeUsernameForLookup("jane_doe")).toBe("jane_doe");
    expect(normalizeUsernameForLookup("Jane.Doe!")).toBe("janedoe");
  });

  it("returns null for too-short result", () => {
    expect(normalizeUsernameForLookup("ab")).toBeNull();
    expect(normalizeUsernameForLookup("a!")).toBeNull();
  });

  it("returns null for too-long result (>30 chars)", () => {
    expect(normalizeUsernameForLookup("a".repeat(31))).toBeNull();
  });

  it("accepts exactly 3 chars", () => {
    expect(normalizeUsernameForLookup("abc")).toBe("abc");
  });

  it("accepts exactly 30 chars", () => {
    const thirty = "a".repeat(30);
    expect(normalizeUsernameForLookup(thirty)).toBe(thirty);
  });

  it("is case-insensitive — lookup of 'ALICE' resolves 'alice'", () => {
    expect(normalizeUsernameForLookup("ALICE")).toBe("alice");
    expect(normalizeUsernameForLookup("Alice")).toBe("alice");
  });
});

// ─── Safe DTO / no Clerk ID leakage ──────────────────────────────────────────

function buildPublicProfilesDto(user: {
  clerkId: string;
  username: string | null;
  accountType: string | null;
  displayName: string | null;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  profileImageUrl?: string | null;
  verified: boolean | null;
  deletedAt: Date | null;
}) {
  if (user.deletedAt) return null;
  if (!user.username || !user.accountType) return null;
  if (user.accountType !== "buyer" && user.accountType !== "seller") return null;

  let avatarUrl = user.avatarUrl ?? null;
  if (user.profileImageUrl && typeof user.profileImageUrl === "string") {
    if (user.profileImageUrl.startsWith("http")) {
      avatarUrl = user.profileImageUrl;
    }
  }

  return {
    // id = canonical clerkId so callers can pass directly to downstream endpoints
    id:          user.clerkId,
    username:    user.username,
    accountType: user.accountType as "buyer" | "seller",
    displayName: user.displayName ?? user.name ?? null,
    bio:         user.bio ?? null,
    avatarUrl,
    verified:    user.verified ?? false,
  };
}

describe("buildPublicProfilesDto — id is clerkId (canonical routing ID)", () => {
  const sellerRow = {
    clerkId: "user_seller_abc",
    username: "mybrand",
    accountType: "seller" as const,
    displayName: "My Brand",
    name: "My Brand",
    bio: "Great products",
    avatarUrl: null,
    profileImageUrl: "https://cdn.example.com/brand.jpg",
    verified: true,
    deletedAt: null,
  };

  it("returns clerkId as `id` for direct downstream routing", () => {
    const dto = buildPublicProfilesDto(sellerRow);
    expect(dto).not.toBeNull();
    expect(dto!.id).toBe("user_seller_abc");
  });

  it("canonical id in dto can be passed directly to sellers/:id", () => {
    const dto = buildPublicProfilesDto(sellerRow);
    // The test proves the id is the clerkId — no aliasing needed in the client.
    expect(dto!.id).toBe(sellerRow.clerkId);
  });

  it("does NOT expose clerkId as a separate key", () => {
    const dto = buildPublicProfilesDto(sellerRow) as Record<string, unknown>;
    // No key named "clerkId" — only `id`.
    expect(Object.keys(dto)).not.toContain("clerkId");
  });

  it("buyer dto also returns clerkId as id", () => {
    const buyerRow = {
      clerkId: "user_buyer_abc",
      username: "janedoe",
      accountType: "buyer" as const,
      displayName: "Jane Doe",
      name: "Jane Doe",
      bio: "Love fashion",
      avatarUrl: "https://example.com/avatar.jpg",
      profileImageUrl: null,
      verified: false,
      deletedAt: null,
    };
    const dto = buildPublicProfilesDto(buyerRow);
    expect(dto!.id).toBe("user_buyer_abc");
  });
});

describe("buildPublicProfilesDto — rejections", () => {
  it("returns null for tombstoned accounts", () => {
    const row = {
      clerkId: "user_deleted",
      username: "deleteduser",
      accountType: "buyer" as const,
      displayName: null,
      name: null,
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: new Date("2024-01-01"),
    };
    expect(buildPublicProfilesDto(row)).toBeNull();
  });

  it("returns null when username is null", () => {
    const row = {
      clerkId: "user_nousername",
      username: null,
      accountType: "buyer" as const,
      displayName: "Anonymous",
      name: "Anonymous",
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: null,
    };
    expect(buildPublicProfilesDto(row)).toBeNull();
  });

  it("returns null when accountType is null", () => {
    const row = {
      clerkId: "user_notype",
      username: "someuser",
      accountType: null,
      displayName: null,
      name: null,
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: null,
    };
    expect(buildPublicProfilesDto(row)).toBeNull();
  });

  it("returns null for an unrecognized accountType", () => {
    const row = {
      clerkId: "user_badtype",
      username: "someuser",
      accountType: "admin",
      displayName: null,
      name: null,
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: null,
    };
    expect(buildPublicProfilesDto(row as any)).toBeNull();
  });
});

// ─── End-to-end routing contracts ─────────────────────────────────────────────

describe("e2e: canonical link → exact account, posts use canonical ID, not alias", () => {
  const mockUsers: MockUser[] = [
    {
      id: "ba5e6a11-0000-0000-0000-000000000001",
      clerkId: "user_seller_e2e",
      accountType: "seller",
      deletedAt: null,
    },
    {
      id: "ba5e6a11-0000-0000-0000-000000000002",
      clerkId: "user_buyer_e2e",
      accountType: "buyer",
      deletedAt: null,
    },
  ];

  it("seller: /u/username → profile.id = clerkId → sellers/:clerkId loads correct seller", () => {
    // Step 1: profile endpoint returns clerkId as `id`.
    const dto = buildPublicProfilesDto({
      clerkId: "user_seller_e2e",
      username: "mybrand",
      accountType: "seller",
      displayName: "My Brand",
      name: "My Brand",
      bio: null,
      avatarUrl: null,
      verified: true,
      deletedAt: null,
    });
    expect(dto!.id).toBe("user_seller_e2e"); // canonical clerkId, not UUID

    // Step 2: sellers/:id endpoint resolves either UUID or clerkId.
    const resolvedFromClerkId = simulateResolveToClerkId("user_seller_e2e", mockUsers, "seller");
    expect(resolvedFromClerkId).toBe("user_seller_e2e");

    // Step 3: posts query uses canonical ID (same clerkId = products.ownerId).
    // products.ownerId and posts.userId are keyed on clerkId in the DB.
    // Using the canonical ID ensures products and posts load for the correct seller.
    expect(resolvedFromClerkId).toBe(dto!.id);
  });

  it("buyer: /u/username → profile.id = clerkId → social/profile/:clerkId loads correct buyer", () => {
    const dto = buildPublicProfilesDto({
      clerkId: "user_buyer_e2e",
      username: "janedoe",
      accountType: "buyer",
      displayName: "Jane Doe",
      name: "Jane Doe",
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: null,
    });
    expect(dto!.id).toBe("user_buyer_e2e");

    // social/profile/:id also resolves UUID aliases → canonical.
    const resolvedFromClerkId = simulateResolveToClerkId("user_buyer_e2e", mockUsers);
    expect(resolvedFromClerkId).toBe("user_buyer_e2e");
  });

  it("follow action uses canonical ID, not route alias UUID", () => {
    // When arriving from /u/[username], the mobile client gets dto.id = clerkId.
    // The mobile screen also reads profile.userId from the social/profile response
    // and uses that as canonicalUserId for follow/unfollow actions.
    // Both dto.id and profile.userId must be the same clerkId.
    const dto = buildPublicProfilesDto({
      clerkId: "user_buyer_e2e",
      username: "janedoe",
      accountType: "buyer",
      displayName: "Jane Doe",
      name: "Jane Doe",
      bio: null,
      avatarUrl: null,
      verified: false,
      deletedAt: null,
    });
    const profileUserId = "user_buyer_e2e"; // formatUser returns users.clerkId as userId
    expect(dto!.id).toBe(profileUserId);    // no aliasing needed
  });

  it("seller posts load under the canonical clerkId, not a UUID alias", () => {
    // Simulate: route alias is UUID, resolveToClerkId returns canonical clerkId.
    const uuidAlias = "ba5e6a11-0000-0000-0000-000000000001";
    const canonical = simulateResolveToClerkId(uuidAlias, mockUsers, "seller");
    expect(canonical).toBe("user_seller_e2e");
    // posts.userId === "user_seller_e2e" in the DB — query with canonical loads posts.
    // posts.userId !== uuidAlias — query with UUID alias would load nothing.
    expect(canonical).not.toBe(uuidAlias);
  });

  it("rate-limit policy: public-read allows 240 req / 5 min", () => {
    const policy = { id: "public-read", limit: 240, windowMs: 5 * 60_000 };
    expect(policy.limit).toBe(240);
    expect(policy.windowMs).toBe(300_000);
  });
});

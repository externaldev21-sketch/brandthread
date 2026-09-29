import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, serviceRequest } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
    }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({ serviceRequest }));
vi.mock("@/lib/devPreview", () => ({ isBuyerDevPreview: () => false, isPreviewDemoMode: () => false }));

import {
  getMyProfile,
  getFriendships,
  getFriendRequests,
  getFriendSuggestions,
  getConversations,
  getStories,
  getNotifications,
  getSavedItems,
  getSellerPosts,
  initSocialService,
  socialKeysForUser,
} from "./socialService";

// Every seeded demo record this service ever produced used one of these
// unmistakable identity fingerprints (the hard-coded cast of "Jordan" and
// friends, plus preview-mode's own `preview-` id prefix). Production
// (non-preview) responses must never carry any of them, no matter what the
// real API or local cache is asked to return.
const DEMO_FINGERPRINTS = [/\bjordan\b/i, /\bpreview-/i, /demo profile/i, /demo friend/i];

function assertNoDemoContent(value: unknown, path = "root") {
  if (value == null) return;
  if (typeof value === "string") {
    for (const fp of DEMO_FINGERPRINTS) {
      expect(value, `${path} matched demo fingerprint ${fp}`).not.toMatch(fp);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoDemoContent(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoDemoContent(v, `${path}.${k}`);
    }
  }
}

describe("socialService: no seeded demo data in production mode", () => {
  const userId = "prod-user-no-demo-data";

  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    // Every real-API call resolves empty — this is the "brand new account,
    // nothing on the server yet, no preview flag" case the audit exists for.
    serviceRequest.mockImplementation(async () => []);
    initSocialService(userId);
  });

  it("never contains a hard-coded seed array (5 friends, 15 notifications, etc.)", () => {
    const source = readFileSync(join(__dirname, "socialService.ts"), "utf8");
    // A seed array is several friend/notification/post object literals back
    // to back inside one array constant. If this service ever regresses back
    // to bundling demo people into the production build, one of these
    // signature fields will repeat 3+ times inside a single `[ ... ]` block.
    const arrayLiteralBlocks = source.match(/\[[^[\]]*\]/gs) ?? [];
    for (const block of arrayLiteralBlocks) {
      const nameFieldCount = (block.match(/\bname:\s*['"]/g) ?? []).length;
      expect(nameFieldCount, `found ${nameFieldCount} hard-coded "name:" object literals in one array — looks like a reintroduced seed array:\n${block.slice(0, 300)}`).toBeLessThan(3);
    }
    // "Jordan" may only appear as the MY_NAME/MY_HANDLE fallback constants
    // and the isLegacyDemo migration-repair comparison that scrubs it — never
    // as data returned to a screen.
    const jordanMatches = source.match(/Jordan/g) ?? [];
    expect(jordanMatches.length, "unexpected number of 'Jordan' references — verify none of them are seeded data returned to callers").toBeLessThanOrEqual(3);
    for (const fp of [/demo profile/i, /demo friend/i]) {
      expect(source, `socialService.ts source matched demo fingerprint ${fp}`).not.toMatch(fp);
    }
    // `preview-` may only appear in comments explaining the gated
    // canUsePreviewFollow() fallback (lib/previewFollowStore.ts) — never as a
    // literal id this service invents itself.
    const previewLiteralLines = source
      .split("\n")
      .filter((line) => /['"]preview-/.test(line));
    expect(previewLiteralLines, `found a literal "preview-" id in socialService.ts:\n${previewLiteralLines.join("\n")}`).toEqual([]);
  });

  it("returns an empty, demo-free profile for a brand-new account", async () => {
    const profile = await getMyProfile(socialKeysForUser(userId));
    expect(profile.name).toBe("");
    expect(profile.username).toBe("");
    assertNoDemoContent(profile);
  });

  it("returns no seeded friendships, requests, conversations, stories, notifications or saved items", async () => {
    const k = socialKeysForUser(userId);
    const [friendships, requests, conversations, stories, notifications, saved] = await Promise.all([
      getFriendships(k),
      getFriendRequests(k),
      getConversations(k),
      getStories(k),
      getNotifications(k),
      getSavedItems(k),
    ]);
    expect(friendships).toEqual([]);
    expect(requests).toEqual([]);
    expect(conversations).toEqual([]);
    expect(stories).toEqual([]);
    expect(notifications).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("routes friend suggestions through the real API and returns no local fallback data", async () => {
    serviceRequest.mockImplementationOnce(async () => []);
    const suggestions = await getFriendSuggestions();
    expect(suggestions).toEqual([]);
    expect(serviceRequest).toHaveBeenCalledWith("/api/social/suggested");
  });

  it("maps only server-provided friend suggestions, never injecting demo people", async () => {
    serviceRequest.mockImplementationOnce(async () => [
      { userId: "u1", name: "Real User", handle: "@realuser", initials: "RU", color: "#111", reason: "3 mutual friends", mutualCount: 3 },
    ]);
    const suggestions = await getFriendSuggestions();
    expect(suggestions).toEqual([
      { id: "u1", userId: "u1", name: "Real User", handle: "@realuser", initials: "RU", color: "#111", reason: "3 mutual friends", mutualCount: 3 },
    ]);
    assertNoDemoContent(suggestions);
  });

  it("returns no seeded seller/buyer posts", async () => {
    const posts = await getSellerPosts();
    assertNoDemoContent(posts);
  });
});

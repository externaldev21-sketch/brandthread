/**
 * Counterfeit keyword guard for listings (feature 69).
 *
 * A listing can't go live while its name, description or tags carry a
 * counterfeit signal ("replica", "1:1", "mirror quality", …) or name a
 * commonly counterfeited brand — unless the seller holds the verified badge
 * (lib/sellerEligibility.ts), which means Stripe Identity passed and the
 * account is in good standing. Drafts are never blocked, so a seller can save
 * and fix a listing before publishing it.
 *
 * Kill switch: feature flag `counterfeitKeywordGuard` (default on).
 */
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { normalizeForMatching } from "./contentModerator";
import { deriveSellerVerified } from "./sellerEligibility";
import { isFeatureEnabled } from "./threadCash/wallet";

export const COUNTERFEIT_GUARD_FLAG = "counterfeitKeywordGuard";

/** Words sellers of fakes use to describe them. Matched as whole words/phrases. */
export const COUNTERFEIT_SIGNALS: readonly string[] = [
  "replica", "replicas", "counterfeit", "knockoff", "knock off", "knock-off",
  "1:1", "1 to 1 copy", "mirror quality", "mirror grade", "mirror copy",
  "aaa quality", "aaa grade", "aaa+", "super copy", "high copy", "top copy",
  "unauthorized authentic", "ua quality", "not authentic", "non authentic",
  "fake designer", "designer dupe", "dupe of",
];

/** Brands that are counterfeited most. Naming them needs the verified badge. */
export const PROTECTED_BRANDS: readonly string[] = [
  "louis vuitton", "gucci", "chanel", "hermes", "prada", "dior", "balenciaga",
  "fendi", "versace", "saint laurent", "yves saint laurent", "burberry",
  "givenchy", "bottega veneta", "loewe", "moncler", "valentino garavani",
  "christian louboutin", "golden goose", "maison margiela", "rick owens",
  "vetements", "amiri", "palm angels", "chrome hearts", "gallery dept",
  "fear of god", "rhude", "bape", "a bathing ape", "stone island",
  "canada goose", "rolex", "cartier", "nike", "air jordan", "yeezy", "adidas",
  "new balance", "the north face", "ralph lauren", "lacoste", "michael kors",
  "kate spade", "ugg", "timberland", "lululemon", "patagonia", "arc'teryx",
  "arcteryx", "sp5der", "trapstar", "corteiz", "hellstar", "denim tears",
  "stussy", "carhartt", "kaws",
];

export type ListingText = {
  name?: string | null;
  description?: string | null;
  tags?: readonly unknown[] | null;
  styleTags?: readonly unknown[] | null;
};

export type IntegrityHit = { term: string; kind: "signal" | "brand" };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word match: letters/digits can't touch either end, so "nike" doesn't
// match "nikec" and "ugg" doesn't match "snuggle".
function phraseRegex(phrase: string): RegExp {
  const body = escapeRe(normalizeForMatching(phrase)).replace(/\\?[ -]/g, "[\\s\\-_.]*");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "i");
}

const SIGNAL_RES = COUNTERFEIT_SIGNALS.map((t) => ({ term: t, re: phraseRegex(t) }));
const BRAND_RES = PROTECTED_BRANDS.map((t) => ({ term: t, re: phraseRegex(t) }));

function listingCorpus(input: ListingText): string {
  const parts: string[] = [];
  if (input.name) parts.push(String(input.name));
  if (input.description) parts.push(String(input.description));
  for (const list of [input.tags, input.styleTags]) {
    if (Array.isArray(list)) for (const t of list) if (typeof t === "string") parts.push(t);
  }
  // Separate fields with " | " so a phrase can't straddle two tags.
  return normalizeForMatching(parts.join(" | ")).replace(/[‘’`´]/g, "'");
}

/** Every counterfeit signal and protected brand the listing text mentions. */
export function findCounterfeitTerms(input: ListingText): IntegrityHit[] {
  const text = listingCorpus(input);
  if (!text) return [];
  const hits: IntegrityHit[] = [];
  for (const { term, re } of SIGNAL_RES) if (re.test(text)) hits.push({ term, kind: "signal" });
  for (const { term, re } of BRAND_RES) if (re.test(text)) hits.push({ term, kind: "brand" });
  // "yves saint laurent" also matches "saint laurent"; keep the longer one.
  return hits.filter((h) => !hits.some((o) => o !== h && o.term.length > h.term.length && o.term.includes(h.term)));
}

/** The user-facing refusal for a set of hits. */
export function counterfeitRefusal(hits: IntegrityHit[]) {
  const quoted = hits.slice(0, 3).map((h) => `“${h.term}”`).join(", ");
  return {
    error: `Remove ${quoted} to publish. Only verified brands can use these words in a listing.`,
    code: "COUNTERFEIT_TERMS" as const,
    terms: hits.map((h) => h.term),
    verifyRoute: "/seller-verification",
  };
}

export type IntegrityDeps = {
  flagEnabled?: () => Promise<boolean>;
  sellerVerified?: (ownerId: string) => Promise<boolean>;
};

async function loadSellerVerified(ownerId: string): Promise<boolean> {
  const [row] = await db.select({
    verified: users.verified,
    verificationStatus: users.verificationStatus,
    activeStanding: users.activeStanding,
    policyRestricted: users.policyRestricted,
  }).from(users).where(eq(users.clerkId, ownerId)).limit(1);
  return row ? deriveSellerVerified(row) : false;
}

/**
 * Null when the listing may go live; otherwise the hits that block it.
 * Only call this for listings that are (or are becoming) active.
 */
export async function checkListingIntegrity(
  ownerId: string,
  input: ListingText,
  deps: IntegrityDeps = {},
): Promise<IntegrityHit[] | null> {
  const hits = findCounterfeitTerms(input);
  if (hits.length === 0) return null;
  const enabled = await (deps.flagEnabled ?? (() => isFeatureEnabled(COUNTERFEIT_GUARD_FLAG, true)))();
  if (!enabled) return null;
  const verified = await (deps.sellerVerified ?? loadSellerVerified)(ownerId);
  return verified ? null : hits;
}

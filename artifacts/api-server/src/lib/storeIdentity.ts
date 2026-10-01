/**
 * Store identity rules — brand name and @handle screening, the monochrome
 * accent allowlist and social link normalisation used by the seller setup
 * steps. Pure functions only; uniqueness is checked against the DB by the
 * routes, this file decides what is acceptable to claim at all.
 */
import { normalizeForMatching } from "./contentModerator";

export type IdentityProblem = { code: "INVALID" | "RESERVED" | "BLOCKED"; error: string };

// ─── Screening ───────────────────────────────────────────────────────────────

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t", "€": "e",
};

function unleet(text: string): string {
  return text.replace(/[0-9@$!|+€]/g, (ch) => LEET[ch] ?? ch);
}

/** Lowercase, strip accents, undo leetspeak and drop every non-letter. */
export function squashForScreening(raw: string): string {
  return unleet(normalizeForMatching(raw)).replace(/[^a-z]/g, "");
}

// Stems that are never part of an innocent word, so they are refused even
// when embedded ("fuckboyclothing").
const EMBEDDED_STEMS = [
  "fuck", "shit", "cunt", "bitch", "whore", "nigger", "nigga", "faggot",
  "asshole", "dickhead", "cocksuck", "motherfuck", "bullshit",
];
// Stems without a doubled letter can also be matched after collapsing
// stretched letters ("fuuuck", "shiit").
const COLLAPSIBLE_STEMS = EMBEDDED_STEMS.filter((s) => !/(.)\1/.test(s));

// Words that only count when they stand alone as a token ("ass", "cock"):
// embedding them would reject class, peacock, Dickens, Essex.
const STANDALONE_WORDS = new Set([
  "ass", "arse", "cock", "dick", "piss", "tit", "slut", "twat", "wank", "prick",
  "porn", "anal", "nazi", "hitler", "rape", "cum",
]);

// Innocent words that contain an embedded stem; removed before matching.
const INNOCENT = ["scunthorpe", "cocktail", "shiitake", "matsushita"];

function collapseRuns(text: string, min: number): string {
  return text.replace(new RegExp(`([a-z])\\1{${min - 1},}`, "g"), "$1");
}

function tokens(raw: string): string[] {
  return unleet(normalizeForMatching(raw)).split(/[^a-z]+/).filter(Boolean);
}

export function containsProfanity(raw: string): boolean {
  let squashed = squashForScreening(raw);
  for (const word of INNOCENT) squashed = squashed.split(word).join("");
  const stretched = collapseRuns(squashed, 3);
  const collapsed = collapseRuns(squashed, 2);
  if (EMBEDDED_STEMS.some((s) => squashed.includes(s) || stretched.includes(s))) return true;
  if (COLLAPSIBLE_STEMS.some((s) => collapsed.includes(s))) return true;
  return tokens(raw).some((t) => {
    const word = collapseRuns(t, 2);
    return STANDALONE_WORDS.has(t) || STANDALONE_WORDS.has(word) || STANDALONE_WORDS.has(word.replace(/s$/, ""));
  });
}

// ─── Reserved names ──────────────────────────────────────────────────────────

const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "sysadmin", "moderator", "mod", "staff",
  "support", "help", "helpdesk", "care", "contact", "info", "press", "legal", "abuse",
  "security", "billing", "payments", "payouts", "orders", "returns", "shipping",
  "official", "verified", "team", "api", "app", "www", "web", "mail", "email",
  "about", "terms", "privacy", "login", "logout", "signup", "signin", "settings",
  "store", "shop", "live", "drops", "explore", "search", "home", "null", "undefined",
  "anonymous", "everyone", "you", "me", "stripe", "threadcash", "brandthread",
]);

/** True for reserved handles and anything impersonating the platform. */
export function isReservedHandle(handle: string): boolean {
  const key = handle.toLowerCase().replace(/_/g, "");
  return RESERVED_HANDLES.has(key) || key.includes("brandthread");
}

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export function normalizeHandle(raw: unknown): string {
  return String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
}

export function validateHandle(raw: unknown): { handle: string; problem: IdentityProblem | null } {
  const handle = normalizeHandle(raw);
  if (!handle) return { handle, problem: { code: "INVALID", error: "Choose a handle." } };
  if (/\s/.test(handle)) return { handle, problem: { code: "INVALID", error: "Handles cannot contain spaces." } };
  if (!HANDLE_RE.test(handle)) {
    return { handle, problem: { code: "INVALID", error: "Use 3 to 30 letters, numbers or underscores." } };
  }
  if (isReservedHandle(handle)) return { handle, problem: { code: "RESERVED", error: "That handle is reserved." } };
  if (containsProfanity(handle)) return { handle, problem: { code: "BLOCKED", error: "That handle is not allowed." } };
  return { handle, problem: null };
}

export function normalizeBrandName(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

export function validateBrandName(raw: unknown): { name: string; problem: IdentityProblem | null } {
  const name = normalizeBrandName(raw);
  if (name.length < 2) return { name, problem: { code: "INVALID", error: "Enter at least 2 characters." } };
  if (name.length > 50) return { name, problem: { code: "INVALID", error: "Keep it to 50 characters or fewer." } };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
    return { name, problem: { code: "INVALID", error: "Use letters and numbers in your store name." } };
  }
  const key = squashForScreening(name);
  if (RESERVED_HANDLES.has(key) || key.includes("brandthread")) {
    return { name, problem: { code: "RESERVED", error: "That name is reserved." } };
  }
  if (containsProfanity(name)) return { name, problem: { code: "BLOCKED", error: "That name is not allowed." } };
  return { name, problem: null };
}

// ─── Store accent ────────────────────────────────────────────────────────────

/** Black, white and silver steps only — the app palette. */
export const STORE_ACCENT_COLORS = [
  "#000000", "#4A4A4A", "#8A8A8A", "#C0C0C0", "#E5E5E5", "#FFFFFF",
] as const;

export function normalizeStoreAccent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().toUpperCase();
  return (STORE_ACCENT_COLORS as readonly string[]).includes(hex) ? hex : null;
}

// ─── Social links ────────────────────────────────────────────────────────────

export type SocialPlatform = "instagram" | "tiktok";

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
};
const SOCIAL_HANDLE_RE: Record<SocialPlatform, RegExp> = {
  instagram: /^[a-z0-9._]{1,30}$/,
  tiktok: /^[a-z0-9._]{2,24}$/,
};

function canonicalSocialUrl(platform: SocialPlatform, handle: string): string {
  return platform === "instagram"
    ? `https://www.instagram.com/${handle}`
    : `https://www.tiktok.com/@${handle}`;
}

/**
 * Accepts a handle ("@shop", "shop") or a profile URL on the platform's own
 * domain and returns the canonical https URL. Returns "" for an empty input
 * (clears the link) and null when the value is not acceptable.
 */
export function normalizeSocialLink(platform: SocialPlatform, raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  const input = String(raw).trim();
  if (!input) return "";
  if (input.length > 300) return null;

  let handle: string;
  if (/^https?:\/\//i.test(input) || input.includes("/")) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      return null;
    }
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
    if (!SOCIAL_HOSTS[platform].includes(host)) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (!first) return null;
    try {
      handle = decodeURIComponent(first).replace(/^@/, "").toLowerCase();
    } catch {
      return null;
    }
  } else {
    handle = input.replace(/^@+/, "").toLowerCase();
  }
  if (!SOCIAL_HANDLE_RE[platform].test(handle) || /^\.|\.$|\.\./.test(handle)) return null;
  return canonicalSocialUrl(platform, handle);
}

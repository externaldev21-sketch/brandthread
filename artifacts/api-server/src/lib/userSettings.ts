import { z } from "@workspace/api-zod";

/**
 * Account settings that follow the user across devices — validation + merge
 * (pure, unit-tested). Stored as one shallow JSON object per user
 * (user_settings.settings).
 *
 * GET   /api/me/settings → { settings, updatedAt }
 * PATCH /api/me/settings → body is a partial object of the allowlisted keys
 *   below; each present key replaces the stored value, `null` removes it
 *   (back to the app default), omitted keys are untouched. Unknown keys or
 *   wrong value types are rejected (400), as are oversized bodies.
 *
 * Deliberately NOT here (they have their own server homes): sizes / fit-free
 * style interests (buyer_preferences), the push categories handled by
 * /api/notification-prefs, DM privacy + private account (/api/auth/privacy),
 * and device-only switches (biometric lock, saved login).
 */

/** Max serialized size of one PATCH body and of the stored object. */
export const MAX_PATCH_BYTES = 8 * 1024;
export const MAX_STORED_BYTES = 16 * 1024;

const audience = z.enum(["everyone", "friends", "nobody", "only_me", "friends_of_friends"]);

/** Social privacy fields (socialService PrivacySettings) other than DM privacy
 *  and private-account, which live on /api/auth/privacy. Replaced as a whole. */
export const socialPrivacySchema = z.object({
  whoCanSendFriendRequests: audience.optional(),
  whoCanSeePosts: audience.optional(),
  whoCanSeeFriendsList: audience.optional(),
  whoCanReplyToStories: audience.optional(),
  whoCanMention: audience.optional(),
  activityStatusVisible: z.boolean().optional(),
  readReceiptsEnabled: z.boolean().optional(),
  searchable: z.boolean().optional(),
  contactDiscovery: z.boolean().optional(),
}).strict();

export const BOOLEAN_SETTING_KEYS = [
  "privateAccount", "activityStatus", "readReceipts", "storySharing", "manualTagApproval",
  "messageRequests", "hiddenWords", "hideLikeCounts", "autoplayVideos", "highQualityUploads",
  "dataSaver", "restockAlerts", "priceDropAlerts", "storyNotifications", "marketingNotifications",
  "loginAlerts", "searchable", "contactSync", "showShoppingActivity", "personalizedRecommendations",
  "reduceMotion", "captions", "aiCreator",
] as const;

const boolShape = Object.fromEntries(
  BOOLEAN_SETTING_KEYS.map((k) => [k, z.boolean().nullable().optional()]),
) as Record<(typeof BOOLEAN_SETTING_KEYS)[number], z.ZodOptional<z.ZodNullable<z.ZodBoolean>>>;

const shortText = (max: number) => z.string().trim().max(max).nullable().optional();

export const userSettingsPatchSchema = z.object({
  ...boolShape,
  storyReplies: z.enum(["everyone", "friends", "off"]).nullable().optional(),
  allowMentions: z.enum(["everyone", "friends", "nobody"]).nullable().optional(),
  allowTags: z.enum(["everyone", "friends", "nobody"]).nullable().optional(),
  groupAdds: z.enum(["everyone", "friends"]).nullable().optional(),
  sensitiveContent: z.enum(["less", "standard", "more"]).nullable().optional(),
  preferredFit: z.enum(["slim", "regular", "oversized"]).nullable().optional(),
  theme: z.enum(["system", "dark", "light"]).nullable().optional(),
  language: z.string().trim().min(1).max(40).nullable().optional(),
  pronouns: shortText(40),
  gender: shortText(40),
  socialPrivacy: socialPrivacySchema.nullable().optional(),
}).strict();

export type UserSettingsPatch = z.infer<typeof userSettingsPatchSchema>;
export type StoredUserSettings = Record<string, unknown>;

export type ParseResult =
  | { ok: true; patch: UserSettingsPatch }
  | { ok: false; status: 400 | 413; error: string; issues?: { path: string; message: string }[] };

/** Validates a raw request body. */
export function parseUserSettingsPatch(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Settings must be an object" };
  }
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(body), "utf8"); } catch { size = Infinity; }
  if (size > MAX_PATCH_BYTES) return { ok: false, status: 413, error: "Settings payload too large" };
  const parsed = userSettingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false, status: 400, error: "Invalid settings",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  return { ok: true, patch: parsed.data };
}

/** Drops anything the current allowlist no longer knows (keys renamed/removed over time). */
export function sanitizeStored(stored: unknown): StoredUserSettings {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: StoredUserSettings = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    const check = userSettingsPatchSchema.safeParse({ [key]: value });
    if (check.success) out[key] = (check.data as Record<string, unknown>)[key];
  }
  return out;
}

/** Shallow merge: present keys replace, null removes, omitted keys untouched. */
export function mergeUserSettings(current: unknown, patch: UserSettingsPatch): StoredUserSettings {
  const next = sanitizeStored(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

export function storedSizeOk(settings: StoredUserSettings): boolean {
  return Buffer.byteLength(JSON.stringify(settings), "utf8") <= MAX_STORED_BYTES;
}

export interface UserSettingsDto {
  settings: StoredUserSettings;
  updatedAt: string | null;
}

export function toUserSettingsDto(row: { settings: unknown; updatedAt: Date } | null | undefined): UserSettingsDto {
  if (!row) return { settings: {}, updatedAt: null };
  return { settings: sanitizeStored(row.settings), updatedAt: row.updatedAt.toISOString() };
}

import { z } from "@workspace/api-zod";

/**
 * Account-level app settings (privacy, content, accessibility, security) —
 * validation, defaults and merge. Pure and unit-tested; the DB access lives
 * in userAppSettingsStore.ts.
 *
 * Stable API shape: GET /api/me/settings returns `{ settings, updatedAt }`
 * where `settings` is the full object below (defaults filled in), PATCH
 * accepts any subset of it. Unknown keys are rejected (400), never stored.
 *
 * Where each one is enforced:
 *   readReceipts         conversations GET /:id/messages masks readAt for the sender
 *   activityStatus       stored; no presence signal exists in the API yet
 *   groupAdds            conversations POST / (group create) — 'friends' requires the invitee to follow the creator
 *   storyReplies         default reply permission for new stories (social.ts)
 *   hideLikeCounts       client display preference (viewer-side)
 *   personalizedRecommendations  For You ranking ignores the taste profile when false
 *   sensitiveContent     stored; the API has no sensitive-content classifier yet
 *   reduceMotion, captions, autoplayVideos, highQualityUploads, dataSaver,
 *   highContrast         client display preferences, synced across devices
 *   loginAlerts          new-sign-in security email (lib/loginAlerts.ts, from /auth/sync)
 *   appLanguage          preferred app language (BCP-47); UI is English-only today
 */
export const USER_APP_SETTINGS_DEFAULTS = {
  readReceipts: true,
  activityStatus: true,
  groupAdds: "everyone" as "everyone" | "friends",
  storyReplies: "everyone" as "everyone" | "friends" | "off",
  hideLikeCounts: false,
  personalizedRecommendations: true,
  sensitiveContent: "standard" as "less" | "standard" | "more",
  reduceMotion: false,
  captions: true,
  autoplayVideos: true,
  highQualityUploads: true,
  dataSaver: false,
  highContrast: false,
  loginAlerts: true,
  appLanguage: "en",
};

export type UserAppSettings = typeof USER_APP_SETTINGS_DEFAULTS;

export const userAppSettingsPatchSchema = z.object({
  readReceipts: z.boolean().optional(),
  activityStatus: z.boolean().optional(),
  groupAdds: z.enum(["everyone", "friends"]).optional(),
  storyReplies: z.enum(["everyone", "friends", "off"]).optional(),
  hideLikeCounts: z.boolean().optional(),
  personalizedRecommendations: z.boolean().optional(),
  sensitiveContent: z.enum(["less", "standard", "more"]).optional(),
  reduceMotion: z.boolean().optional(),
  captions: z.boolean().optional(),
  autoplayVideos: z.boolean().optional(),
  highQualityUploads: z.boolean().optional(),
  dataSaver: z.boolean().optional(),
  highContrast: z.boolean().optional(),
  loginAlerts: z.boolean().optional(),
  // BCP-47-ish language tag: "en", "es", "pt-BR", "zh-Hans".
  appLanguage: z.string().trim().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "Invalid language code").max(16).optional(),
}).strict();

export type UserAppSettingsPatch = z.infer<typeof userAppSettingsPatchSchema>;

/**
 * Normalises whatever is stored (possibly written by an older build, possibly
 * hand-edited) into a complete settings object: stored keys that still pass
 * validation win, everything else falls back to the default.
 */
export function resolveUserAppSettings(stored: unknown): UserAppSettings {
  const out: UserAppSettings = { ...USER_APP_SETTINGS_DEFAULTS };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  const shape = userAppSettingsPatchSchema.shape;
  for (const key of Object.keys(USER_APP_SETTINGS_DEFAULTS) as (keyof UserAppSettings)[]) {
    const raw = (stored as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    const parsed = shape[key].safeParse(raw);
    if (parsed.success && parsed.data !== undefined) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

/** Applies a validated patch on top of the stored settings; returns the full object to persist. */
export function mergeUserAppSettings(stored: unknown, patch: UserAppSettingsPatch): UserAppSettings {
  const current = resolveUserAppSettings(stored);
  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) next[key] = value;
  }
  return next as UserAppSettings;
}

/** True when the patch flips a setting that the For You ranking cache depends on. */
export function patchInvalidatesForYou(before: UserAppSettings, after: UserAppSettings): boolean {
  return before.personalizedRecommendations !== after.personalizedRecommendations;
}

/**
 * Read receipts: a message the viewer SENT shows as read only when every
 * other participant still shares read receipts. Messages from others are
 * untouched (their readAt is the viewer's own read state).
 */
export function maskReadReceipt<M extends { fromId: string; status?: string | null; readAt?: string | undefined }>(
  message: M,
  viewerId: string,
  othersShareReadReceipts: boolean,
): M {
  if (othersShareReadReceipts || message.fromId !== viewerId) return message;
  return {
    ...message,
    readAt: undefined,
    status: message.status === "read" ? "delivered" : message.status,
  };
}

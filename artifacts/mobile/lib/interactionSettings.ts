/**
 * Account interaction settings (server: api-server lib/interactionSettings.ts,
 * GET/PATCH /api/interaction-settings). Pure helpers for the buyer settings
 * rows that show and edit them.
 */

export type CommentAudience = 'everyone' | 'following' | 'nobody';

export type RemixAudience = 'everyone' | 'following' | 'off';

export interface InteractionSettings {
  commentAudience: CommentAudience;
  allowReposts: boolean;
  allowDownloads: boolean;
  /** New tags wait in Pending tags until approved. */
  manualTagApproval: boolean;
  /** Who may remix this account's videos. */
  remixAudience: RemixAudience;
  /** ISO time suggested posts are snoozed until; null when not snoozed. */
  suggestedSnoozedUntil: string | null;
}

/** PATCH body: `snoozeSuggested` starts (true) or ends (false) a 30-day snooze on the server. */
export type InteractionSettingsPatch = Partial<Omit<InteractionSettings, 'suggestedSnoozedUntil'>> & {
  snoozeSuggested?: boolean;
};

/** What the server stores for an account that never changed anything. */
export const DEFAULT_INTERACTION_SETTINGS: InteractionSettings = {
  commentAudience: 'everyone',
  allowReposts: true,
  allowDownloads: true,
  manualTagApproval: false,
  remixAudience: 'everyone',
  suggestedSnoozedUntil: null,
};

/** Same length as the server's snooze (lib/interactionSettings.ts SUGGESTED_SNOOZE_DAYS). */
export const SUGGESTED_SNOOZE_DAYS = 30;

export const REMIX_AUDIENCE_OPTIONS: Array<{ id: RemixAudience; label: string; description: string }> = [
  { id: 'everyone', label: 'Everyone', description: 'Anyone who can see your videos' },
  { id: 'following', label: 'People you follow', description: 'Only accounts you follow' },
  { id: 'off', label: 'Off', description: 'No one can remix your videos' },
];

export function remixAudienceLabel(audience: RemixAudience): string {
  return REMIX_AUDIENCE_OPTIONS.find(option => option.id === audience)?.label ?? 'Everyone';
}

/** The snooze end when it is still in the future, else null. */
export function activeSnoozeUntil(value: string | null | undefined, now: Date = new Date()): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= now.getTime() ? null : date;
}

/** "Off" or "Until Nov 5" for the Snooze suggested posts row. */
export function snoozeLabel(value: string | null | undefined, now: Date = new Date()): string {
  const until = activeSnoozeUntil(value, now);
  if (!until) return 'Off';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sameYear = until.getFullYear() === now.getFullYear();
  return `Until ${months[until.getMonth()]} ${until.getDate()}${sameYear ? '' : `, ${until.getFullYear()}`}`;
}

/** Local stand-in for the server patch (signed-out preview keeps edits on the device). */
export function applyInteractionPatch(
  current: InteractionSettings,
  patch: InteractionSettingsPatch,
  now: Date = new Date(),
): InteractionSettings {
  const { snoozeSuggested, ...rest } = patch;
  const next: InteractionSettings = { ...current, ...rest };
  if (snoozeSuggested === true) {
    next.suggestedSnoozedUntil = new Date(now.getTime() + SUGGESTED_SNOOZE_DAYS * 86_400_000).toISOString();
  } else if (snoozeSuggested === false) {
    next.suggestedSnoozedUntil = null;
  }
  return next;
}

/** A pending tag (GET /api/interaction-settings/pending-tags). */
export interface PendingTag {
  kind: 'post' | 'story';
  id: string;
  authorId: string;
  authorName: string | null;
  authorUsername: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  createdAt: string;
}

/** "@handle tagged you in a post" / "… in their story". */
export function pendingTagTitle(tag: Pick<PendingTag, 'kind' | 'authorName' | 'authorUsername'>): string {
  const who = tag.authorUsername ? `@${tag.authorUsername}` : tag.authorName || 'Someone';
  return tag.kind === 'story' ? `${who} tagged you in their story` : `${who} tagged you in a post`;
}

/** "Remix of @handle" credit line, or null when the source author is unknown. */
export function remixCreditLabel(remixOf: { username?: string | null } | null | undefined): string | null {
  const handle = remixOf?.username?.replace(/^@/, '').trim();
  return handle ? `Remix of @${handle}` : null;
}

export const COMMENT_AUDIENCE_OPTIONS: Array<{ id: CommentAudience; label: string; description: string }> = [
  { id: 'everyone', label: 'Everyone', description: 'Anyone who can see your posts' },
  { id: 'following', label: 'People you follow', description: 'Only accounts you follow' },
  { id: 'nobody', label: 'No one', description: 'Turns comments off on your posts' },
];

export function commentAudienceLabel(audience: CommentAudience): string {
  return COMMENT_AUDIENCE_OPTIONS.find(option => option.id === audience)?.label ?? 'Everyone';
}

/** "0 people", "1 person", "12 people". */
export function peopleCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** Selection changes for the "Hide story from" list: was anything added or removed? */
export function hiddenListChanged(saved: readonly string[], next: Iterable<string>): boolean {
  const nextSet = new Set(next);
  if (nextSet.size !== new Set(saved).size) return true;
  return saved.some(id => !nextSet.has(id));
}

/**
 * Account interaction settings (server: api-server lib/interactionSettings.ts,
 * GET/PATCH /api/interaction-settings). Pure helpers for the buyer settings
 * rows that show and edit them.
 */

export type CommentAudience = 'everyone' | 'following' | 'nobody';

export interface InteractionSettings {
  commentAudience: CommentAudience;
  allowReposts: boolean;
  allowDownloads: boolean;
}

/** What the server stores for an account that never changed anything. */
export const DEFAULT_INTERACTION_SETTINGS: InteractionSettings = {
  commentAudience: 'everyone',
  allowReposts: true,
  allowDownloads: true,
};

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

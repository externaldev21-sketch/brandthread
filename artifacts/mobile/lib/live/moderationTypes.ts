/** Shared client types for live moderation + co-host (see routes/live-moderation.ts, routes/live-cohost.ts). */

export interface LiveRestrictedUser {
  userId: string;
  displayName: string;
  username: string;
  createdAt: string;
}

export interface LiveModerationState {
  bannedWords: string[];
  slowModeSeconds: number;
  pinnedCommentId: string | null;
  muted: LiveRestrictedUser[];
  banned: LiveRestrictedUser[];
}

export interface LiveCohostCandidate {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  followed: boolean;
}

export interface LiveCohostPerson {
  userId: string;
  agoraUid: number | null;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

export interface LiveCohostInvite {
  streamId: string;
  title: string;
  hostName: string;
  hostUsername: string;
  hostAvatarUrl: string | null;
  createdAt: string;
}

/** Slow-mode choices shown in the host's Moderation screen (0 = off). */
export const SLOW_MODE_OPTIONS = [0, 5, 10, 30, 60] as const;

/** Adds/removes a word from a banned-words list the same way the server normalises it. */
export function addBannedWord(list: string[], raw: string): string[] {
  const w = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
  if (!w || list.includes(w)) return list;
  return [...list, w];
}

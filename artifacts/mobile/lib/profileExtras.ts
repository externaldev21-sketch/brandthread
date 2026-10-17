/**
 * Pure helpers for the server-backed profile extras (pronouns, Style badge)
 * and for saving Personal Details through PATCH /api/auth/profile.
 * No React / AsyncStorage imports so they stay unit-testable.
 */
import { formatHandleCooldown } from './accountSecurityErrors';
import type { StyleBadgeState } from './styleBadge';

/** Server limits (api-server src/lib/profileExtras.ts, migration 271). */
export const PRONOUNS_MAX = 30;
export const STYLE_BADGE_LABEL_MAX = 24;
export const STYLE_BADGE_EMOJI_MAX = 8;

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/** Normalizes a typed handle the same way the server stores it. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  return USERNAME_RE.test(normalizeUsername(raw));
}

/** Public profile link encoded in the QR code; null until a server handle exists. */
export function profileQrUrl(serverUsername: string | null | undefined): string | null {
  const u = normalizeUsername(serverUsername ?? '');
  return USERNAME_RE.test(u) ? `https://brandthread.app/u/${u}` : null;
}

export type PersonalDetailsInput = { name: string; username: string; pronouns: string };

/**
 * The PATCH body for Personal Details. Only changed fields are sent, so an
 * unchanged handle never trips the 30-day username cooldown. A blank name or
 * username is never sent (it would clear the saved one).
 */
export function personalDetailsPatch(
  next: PersonalDetailsInput,
  saved: PersonalDetailsInput,
): { name?: string; displayName?: string; username?: string; pronouns?: string } {
  const body: { name?: string; displayName?: string; username?: string; pronouns?: string } = {};
  const name = next.name.trim().replace(/\s+/g, ' ');
  if (name && name !== saved.name.trim()) {
    body.name = name;
    body.displayName = name;
  }
  const username = normalizeUsername(next.username);
  if (username && username !== normalizeUsername(saved.username)) body.username = username;
  const pronouns = next.pronouns.trim();
  if (pronouns !== saved.pronouns.trim()) body.pronouns = pronouns;
  return body;
}

export type ProfileSaveError = { field: 'username' | 'pronouns' | null; message: string };

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Maps a failed PATCH /api/auth/profile to copy a person can act on. */
export function profileSaveErrorMessage(err: unknown, now: Date = new Date()): ProfileSaveError {
  const e = (err && typeof err === 'object' ? err : {}) as { status?: unknown; code?: unknown; body?: unknown; message?: unknown };
  const body = parseBody(e.body);
  const code = typeof e.code === 'string' ? e.code : typeof body.code === 'string' ? body.code : undefined;
  if (code === 'USERNAME_TAKEN') return { field: 'username', message: 'That username is already taken.' };
  if (code === 'USERNAME_COOLDOWN') {
    const next = typeof body.nextChangeAt === 'string' ? body.nextChangeAt : null;
    return {
      field: 'username',
      message: next ? formatHandleCooldown(next, now) : 'You can change your username once every 30 days.',
    };
  }
  if (typeof e.status !== 'number') {
    return { field: null, message: "Couldn't reach Brandthread. Check your connection and try again." };
  }
  if (e.status === 401) return { field: null, message: 'Your session expired. Sign in again and retry.' };
  if (e.status === 400) {
    const serverMessage = typeof body.error === 'string' ? body.error : '';
    if (/username/i.test(serverMessage)) return { field: 'username', message: serverMessage };
    return { field: null, message: serverMessage || 'Some details are not valid. Check them and try again.' };
  }
  return { field: null, message: 'Could not save your details. Please try again.' };
}

/** A well-formed badge from GET /api/auth/me, or null when unset/malformed. */
export function styleBadgeFromServer(raw: unknown): StyleBadgeState | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.label !== 'string' || !b.label.trim()) return null;
  return {
    label: b.label.trim().slice(0, STYLE_BADGE_LABEL_MAX),
    emoji: typeof b.emoji === 'string' ? b.emoji.trim().slice(0, STYLE_BADGE_EMOJI_MAX) : '',
    enabled: b.enabled === true,
  };
}

/** A badge other people may see (public profile shape: no `enabled`; already filtered). */
export function publicStyleBadgeLabel(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (!label) return null;
  const emoji = typeof b.emoji === 'string' ? b.emoji.trim() : '';
  return emoji ? `${emoji} ${label}` : label;
}

/** The PATCH value for a badge typed into Edit Profile, clamped to server limits. */
export function styleBadgeForServer(state: StyleBadgeState): { label: string; emoji: string; enabled: boolean } {
  return {
    label: state.label.trim().slice(0, STYLE_BADGE_LABEL_MAX),
    emoji: state.emoji.trim().slice(0, STYLE_BADGE_EMOJI_MAX),
    enabled: state.enabled,
  };
}

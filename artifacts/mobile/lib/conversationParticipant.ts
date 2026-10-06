/**
 * Resolves "who is the other person in this conversation" for the chat
 * settings screens (conversation-details / conversation-nicknames), which are
 * opened by query params. Callers pass whatever participant fields the
 * opening screen put in the URL plus, when available, the loaded
 * conversation's first participant. URL params win field-by-field; the
 * conversation fills the gaps. Returns null when neither has a name — the
 * screen then shows a not-found state instead of a blank "Conversation"
 * placeholder with an empty avatar.
 *
 * Dependency-free (no React / theme imports) so it's unit-testable.
 */
import { pickAvatarColor } from '@/lib/avatarColors';

export interface ParticipantParams {
  participantUserId?: string;
  participantName?: string;
  participantHandle?: string;
  participantInitials?: string;
  participantColor?: string;
  participantAvatarUri?: string;
  participantNickname?: string;
}

export interface ParticipantLike {
  userId?: string;
  name?: string;
  handle?: string;
  initials?: string;
  color?: string;
  avatarUri?: string;
  nickname?: string | null;
}

export interface ResolvedParticipant {
  userId: string | null;
  name: string;
  handle: string | null;
  initials: string;
  color: string;
  avatarUri: string | null;
  nickname: string | null;
}

const clean = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Up to two initials from a display name ("Rae Kim" → "RK", "orison" → "O"). */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(w => Array.from(w)[0] ?? '').join('');
  return letters.toUpperCase() || '?';
}

/** Single route param value (expo-router can hand back string[] for repeated keys). */
export function firstParam(v: string | string[] | undefined): string | null {
  return clean(Array.isArray(v) ? v[0] : v);
}

export function resolveConversationParticipant(
  params: ParticipantParams,
  participant?: ParticipantLike | null,
): ResolvedParticipant | null {
  const name = clean(params.participantName) ?? clean(participant?.name);
  if (!name) return null;
  const userId = clean(params.participantUserId) ?? clean(participant?.userId);
  return {
    userId,
    name,
    handle: clean(params.participantHandle) ?? clean(participant?.handle),
    initials: clean(params.participantInitials) ?? clean(participant?.initials) ?? initialsFromName(name),
    color: clean(params.participantColor) ?? clean(participant?.color) ?? pickAvatarColor(userId ?? name),
    avatarUri: clean(params.participantAvatarUri) ?? clean(participant?.avatarUri),
    nickname: clean(params.participantNickname) ?? clean(participant?.nickname),
  };
}

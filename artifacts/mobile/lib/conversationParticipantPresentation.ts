import { pickAvatarColor } from '@/lib/avatarColors';
import { cleanParam } from '@/lib/conversationParticipant';

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

export function initialsFromName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => Array.from(w)[0] ?? '').join('').toUpperCase() || '?';
}

export function firstParam(value: string | string[] | undefined): string | null {
  return cleanParam(value) || null;
}

/** Presentation only; mutation authorization still uses the conversation resolver. */
export function resolveConversationParticipant(params: ParticipantParams, participant?: ParticipantLike | null) {
  const clean = (v: string | null | undefined) => cleanParam(v) || null;
  const name = clean(params.participantName) ?? clean(participant?.name);
  if (!name) return null;
  const userId = clean(params.participantUserId) ?? clean(participant?.userId);
  return {
    userId, name,
    handle: clean(params.participantHandle) ?? clean(participant?.handle),
    initials: clean(params.participantInitials) ?? clean(participant?.initials) ?? initialsFromName(name),
    color: clean(params.participantColor) ?? clean(participant?.color) ?? pickAvatarColor(userId ?? name),
    avatarUri: clean(params.participantAvatarUri) ?? clean(participant?.avatarUri),
    nickname: clean(params.participantNickname) ?? clean(participant?.nickname),
  };
}

/**
 * Resolves "the other person" for the chat-details sub-screens
 * (conversation-nicknames.tsx, conversation-privacy-safety.tsx). Those
 * screens are opened by query params from conversation-details.tsx, but a
 * direct/deep-link load can arrive with none (or with the literal string
 * "undefined" from URLSearchParams), which previously rendered
 * "Block undefined" / "Set a nickname for ." — so when the params don't
 * carry a name, the participant is loaded from the conversation itself, and
 * a missing conversation resolves to a not-found result instead.
 */

export interface OtherParticipant {
  userId: string;
  name: string;
  nickname?: string;
}

export interface ConversationParticipantParams {
  id?: string;
  participantUserId?: string;
  participantName?: string;
  participantNickname?: string;
}

type ParticipantLike = {
  userId?: string; name?: string; handle?: string; nickname?: string | null;
};
type ConversationLike = { participants?: ParticipantLike[] | null } | null | undefined;

export type ParticipantResult =
  | { status: 'ready'; participant: OtherParticipant }
  | { status: 'not-found' }
  | { status: 'error' };

/** A query param value, with the "undefined"/"null" strings that
 *  URLSearchParams produces for missing values treated as absent. */
export function cleanParam(value: string | string[] | undefined | null): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null) return '';
  const t = String(v).trim();
  return t === 'undefined' || t === 'null' ? '' : t;
}

/** Participant straight from params, when they carry both an id and a name. */
export function participantFromParams(params: ConversationParticipantParams): OtherParticipant | null {
  const userId = cleanParam(params.participantUserId);
  const name = cleanParam(params.participantName);
  if (!userId || !name) return null;
  const nickname = cleanParam(params.participantNickname);
  return { userId, name, ...(nickname ? { nickname } : {}) };
}

/** The participant who isn't the viewer. `myIds` are every id the viewer may
 *  appear as (their real id, plus the preview inbox's 'me'). */
export function pickOtherParticipant(conv: ConversationLike, myIds: string[]): OtherParticipant | null {
  const parts = (conv?.participants ?? []).filter((p): p is ParticipantLike & { userId: string } => !!p?.userId);
  const mine = new Set(myIds.filter(Boolean));
  const other = parts.find((p) => !mine.has(p.userId)) ?? null;
  if (!other) return null;
  const name = cleanParam(other.name) || cleanParam(other.handle);
  if (!name) return null;
  const nickname = cleanParam(other.nickname ?? undefined);
  return { userId: other.userId, name, ...(nickname ? { nickname } : {}) };
}

export interface ResolveDeps {
  myIds: string[];
  /** Seeded preview inbox lookup (buyer or seller); null when not a preview id. */
  getPreview: (id: string) => ConversationLike | null;
  isPreviewId: (id: string) => boolean;
  /** Dev-preview session with no backend — never hit the network. */
  isDevPreviewSession: boolean;
  fetchConversation: (id: string) => Promise<ConversationLike>;
}

export async function resolveConversationParticipant(
  params: ConversationParticipantParams,
  deps: ResolveDeps,
): Promise<ParticipantResult> {
  // Every action on these screens is scoped to a conversation, so no id
  // means there is nothing to act on, even if a name was passed.
  const id = cleanParam(params.id);
  if (!id) return { status: 'not-found' };
  const fromParams = participantFromParams(params);
  if (fromParams) return { status: 'ready', participant: fromParams };
  if (deps.isPreviewId(id) || deps.isDevPreviewSession) {
    const p = pickOtherParticipant(deps.getPreview(id), deps.myIds);
    return p ? { status: 'ready', participant: p } : { status: 'not-found' };
  }
  try {
    const p = pickOtherParticipant(await deps.fetchConversation(id), deps.myIds);
    return p ? { status: 'ready', participant: p } : { status: 'not-found' };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    return status === 404 || status === 403 ? { status: 'not-found' } : { status: 'error' };
  }
}

/** Save is meaningful only when the trimmed value differs from the current
 *  nickname (an empty value clears an existing nickname server-side). */
export function canSaveNickname(value: string, initial: string | undefined): boolean {
  return value.trim() !== (initial ?? '').trim();
}

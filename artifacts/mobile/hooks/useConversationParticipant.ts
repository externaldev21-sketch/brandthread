import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/expo';
import { useApi } from '@/lib/api';
import {
  isPreviewConversationId, getPreviewConversation,
  isSellerPreviewConversationId, getSellerPreviewConversation,
} from '@/lib/previewInbox';
import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';
import { MY_USER_ID } from '@/services/socialService';
import {
  cleanParam, participantFromParams, resolveConversationParticipant,
  type ConversationParticipantParams, type ParticipantResult,
} from '@/lib/conversationParticipant';

export type ConversationParticipantState = ParticipantResult | { status: 'loading' };

/** The other participant for a chat-details sub-screen: from params when the
 *  opener passed them, otherwise loaded from the conversation (see
 *  lib/conversationParticipant.ts). */
export function useConversationParticipant(params: ConversationParticipantParams) {
  const api = useApi();
  const { user } = useUser();
  const myId = user?.id ?? '';
  const initial = cleanParam(params.id) ? participantFromParams(params) : null;
  const [state, setState] = useState<ConversationParticipantState>(
    initial ? { status: 'ready', participant: initial } : { status: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  const { id, participantUserId, participantName, participantNickname } = params;

  useEffect(() => {
    let cancelled = false;
    resolveConversationParticipant({ id, participantUserId, participantName, participantNickname }, {
      myIds: [myId, MY_USER_ID],
      isPreviewId: (cid) => isPreviewConversationId(cid) || isSellerPreviewConversationId(cid),
      getPreview: (cid) => getPreviewConversation(cid) ?? getSellerPreviewConversation(cid),
      isDevPreviewSession: isSellerDevPreview() || isBuyerDevPreview(),
      fetchConversation: (cid) => api.conversations.get(cid),
    }).then((result) => { if (!cancelled) setState(result); });
    return () => { cancelled = true; };
  }, [id, participantUserId, participantName, participantNickname, myId, api, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

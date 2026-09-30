/**
 * Preview-aware wrappers for the three message-request actions (Accept /
 * Delete / Block) on the SELLER side — the seller-side mirror of
 * lib/requestActions.ts, shared between app/seller-inbox.tsx (the Requests
 * tab) and app/seller-conversation.tsx (the request-mode bottom panel) so
 * neither screen duplicates the `isSellerPreviewConversationId()` branching.
 *
 * Real conversation ids go through the real API (see
 * artifacts/api-server/src/routes/conversations.ts) — the new every-role-pair
 * DM routing means a seller can now receive a genuine, unsolicited buyer
 * request the same way a buyer already can. Seeded seller-preview ids (see
 * lib/previewInbox.ts's SELLER_ID_PREFIX) have no real backend record — every
 * real API call for one 404s — so they're mutated in the local seller preview
 * cache instead, same pattern lib/requestActions.ts uses for the buyer side.
 */
import type { BrandthreadApi } from './api';
import {
  isSellerPreviewConversationId, acceptSellerPreviewConversationRequest, deleteSellerPreviewConversationRequest,
} from './previewInbox';
import { schedulePendingConversationDelete, cancelPendingConversationDelete } from './pendingRequestDeletes';
import { blockUser as blockUserLocal, notifySocialListeners } from '@/services/socialService';

export interface SellerRequestBlockSubject {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
}

/** Accepts a message request — real API for a real conversation id, the
 *  local seller preview-cache mutator for a seeded preview id. */
export async function acceptSellerConversationRequest(id: string, api: BrandthreadApi): Promise<void> {
  if (isSellerPreviewConversationId(id)) {
    acceptSellerPreviewConversationRequest(id);
    return;
  }
  await api.conversations.accept(id);
}

/** Starts the ~4s undo window for deleting a message request, then performs
 *  the real (irreversible) delete — or the preview-mode equivalent — only if
 *  it's never cancelled. See lib/pendingRequestDeletes.ts (shared with the
 *  buyer side — it's keyed purely by conversation id, nothing buyer-specific
 *  about it).
 *
 *  `onCommitted` fires once the delete actually goes through — the caller's
 *  own local conversations state (e.g. seller-inbox.tsx's) needs this to
 *  drop the row for good, same reasoning as lib/requestActions.ts's
 *  identical parameter (see its doc comment for the bug this fixes). */
export function scheduleDeleteSellerConversationRequest(
  id: string,
  api: BrandthreadApi,
  onCommitted?: () => void,
): void {
  schedulePendingConversationDelete(id, async () => {
    try {
      if (isSellerPreviewConversationId(id)) {
        deleteSellerPreviewConversationRequest(id);
        return;
      }
      try {
        await api.conversations.decline(id);
      } catch {
        // Best-effort — if the real delete fails (e.g. already gone) there's
        // nothing left for the UI to roll back to; the row already left the
        // list when the undo window opened.
      }
    } finally {
      onCommitted?.();
      notifySocialListeners();
    }
  });
}

/** Cancels a pending delete started above ("Undo" was tapped in time). */
export function undoDeleteSellerConversationRequest(id: string): void {
  cancelPendingConversationDelete(id);
}

/**
 * Blocks the other participant (a buyer) in a message request. A seeded
 * seller preview conversation has no real backend user to block against —
 * `blockUser()` always calls the real `/api/social/block` endpoint, which
 * would fail (no signed-in account, and the preview buyer ids don't exist
 * server-side), so preview mode just removes the request locally without a
 * network call, and also permanently drops the seeded conversation itself
 * (matching what a real block does: it disappears from the inbox).
 */
export async function blockSellerConversationRequestUser(
  conversationId: string,
  subject: SellerRequestBlockSubject,
): Promise<void> {
  if (isSellerPreviewConversationId(conversationId)) {
    deleteSellerPreviewConversationRequest(conversationId);
    return;
  }
  await blockUserLocal(subject);
}

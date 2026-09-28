/**
 * Preview-aware wrappers for the three message-request actions (Accept /
 * Delete / Block), shared between app/(buyer)/inbox.tsx (the Requests list)
 * and app/buyer-conversation.tsx (the request-mode bottom panel) so neither
 * screen duplicates the `isPreviewConversationId()` branching.
 *
 * Real conversation ids go through the real API (see
 * artifacts/api-server/src/routes/conversations.ts). Seeded preview ids (see
 * lib/previewInbox.ts) have no real backend record — every real API call for
 * one 404s — so they're mutated in the local preview cache instead. This is
 * exactly the bug the redesign fixes: the old `acceptRequest` called
 * `api.conversations.accept()` unconditionally, so every preview-mode Accept
 * tap 404'd and silently failed.
 */
import type { BrandthreadApi } from './api';
import {
  isPreviewConversationId, acceptPreviewConversationRequest, deletePreviewConversationRequest,
} from './previewInbox';
import { schedulePendingConversationDelete, cancelPendingConversationDelete } from './pendingRequestDeletes';
import { blockUser as blockUserLocal } from '@/services/socialService';

export interface RequestBlockSubject {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
}

/** Accepts a message request — real API for a real conversation id, the
 *  local preview-cache mutator for a seeded preview id. */
export async function acceptConversationRequest(id: string, api: BrandthreadApi): Promise<void> {
  if (isPreviewConversationId(id)) {
    acceptPreviewConversationRequest(id);
    return;
  }
  await api.conversations.accept(id);
}

/** Starts the ~4s undo window for deleting a message request, then performs
 *  the real (irreversible) delete — or the preview-mode equivalent — only if
 *  it's never cancelled. See lib/pendingRequestDeletes.ts. */
export function scheduleDeleteConversationRequest(id: string, api: BrandthreadApi): void {
  schedulePendingConversationDelete(id, async () => {
    if (isPreviewConversationId(id)) {
      deletePreviewConversationRequest(id);
      return;
    }
    try {
      await api.conversations.decline(id);
    } catch {
      // Best-effort — if the real delete fails (e.g. already gone) there's
      // nothing left for the UI to roll back to; the row already left the
      // list when the undo window opened.
    }
  });
}

/** Cancels a pending delete started above ("Undo" was tapped in time). */
export function undoDeleteConversationRequest(id: string): void {
  cancelPendingConversationDelete(id);
}

/**
 * Blocks the other participant in a message request. A seeded preview
 * conversation has no real backend user to block against — `blockUser()`
 * always calls the real `/api/social/block` endpoint, which would fail (no
 * signed-in account, and the preview seller ids don't exist server-side), so
 * preview mode just removes the request locally without a network call, and
 * also permanently drops the seeded conversation itself (matching what a
 * real block does: it disappears from the inbox).
 */
export async function blockConversationRequestUser(
  conversationId: string,
  subject: RequestBlockSubject,
): Promise<void> {
  if (isPreviewConversationId(conversationId)) {
    deletePreviewConversationRequest(conversationId);
    return;
  }
  await blockUserLocal(subject);
}

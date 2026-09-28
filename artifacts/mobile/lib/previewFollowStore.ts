/**
 * Preview follow store — follow / unfollow / follow back for the seeded cast
 * of the dev-web preview (?bt_preview=buyer|seller, no real account).
 *
 * The preview has no account, so POST/DELETE /api/social/follow answers 401
 * and every Follow pill used to roll back. This keeps the follow state of
 * seeded people (`preview-*` ids — the same cast previewCatalog /
 * previewActivity / previewInbox use) in memory for the session instead,
 * the same "fake but stateful" module-level pattern as
 * previewInbox.setPreviewConversationPinned and previewActivity's read state.
 *
 * Gating: only in dev builds (`__DEV__`, the same gate as
 * isPreviewCatalogEnabled — dead code in production) and only for
 * `preview-*` ids, so a real account's follow request is never faked, even in
 * dev. Pure (no asset imports) so it's unit-testable.
 */

const following = new Map<string, boolean>();

export function isPreviewPersonId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-');
}

/** Whether a follow request for `userId` may be satisfied by this store. */
export function canUsePreviewFollow(userId: string | null | undefined): boolean {
  return __DEV__ && isPreviewPersonId(userId);
}

export function setPreviewFollowing(userId: string, value: boolean): void {
  following.set(userId, value);
}

/** This session's follow state for a seeded person, or undefined if untouched. */
export function getPreviewFollowing(userId: string | null | undefined): boolean | undefined {
  return userId ? following.get(userId) : undefined;
}

/**
 * Seeded Activity rows with this session's follow state applied, so a follow
 * back survives a refetch/re-visit (the live feed sends the same
 * `isFollowingActor` field from the server).
 */
export function applyPreviewFollowState<T extends { type: string; actorId?: string; isFollowingActor?: boolean }>(
  items: readonly T[],
): T[] {
  return items.map((item) => {
    if (item.type !== 'new_follower') return item;
    const state = getPreviewFollowing(item.actorId);
    return state === undefined ? item : { ...item, isFollowingActor: state };
  });
}

/** Test-only reset. */
export function resetPreviewFollowStore(): void {
  following.clear();
}

/**
 * Tiny pub/sub so the inbox (which reloads joined communities on focus) can
 * tell the tab-bar badge to refresh without a second fast poll.
 */
const listeners = new Set<() => void>();

export function notifyJoinedCommunitiesChanged(): void {
  listeners.forEach((l) => l());
}

export function subscribeJoinedCommunitiesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

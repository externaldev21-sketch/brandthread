/**
 * A tiny in-memory pub/sub so the comments sheet (a separate routed screen)
 * can bump the feed's rail comment count the instant a comment posts,
 * without waiting for the feed to refetch the post. The feed's rail
 * subscribes per-post via `useCommentCountDelta`; the comments screen calls
 * `bumpCommentCount` right after a successful (or locally-appended preview)
 * post. Purely additive and session-local — never persisted, never a
 * replacement for the real count the server eventually returns.
 */
import { useEffect, useState, useRef } from 'react';

type Listener = (postId: string, delta: number) => void;

const deltas = new Map<string, number>();
const listeners = new Set<Listener>();

export function bumpCommentCount(postId: string, delta = 1): void {
  const next = (deltas.get(postId) ?? 0) + delta;
  deltas.set(postId, next);
  listeners.forEach(fn => fn(postId, next));
}

export function getCommentCountDelta(postId: string): number {
  return deltas.get(postId) ?? 0;
}

/** Live delta for one post — 0 until `bumpCommentCount` is called for it. */
export function useCommentCountDelta(postId: string, serverCount?: number): number {
  const [observed, setObserved] = useState(() => ({ postId, value: getCommentCountDelta(postId) }));
  const delta = observed.postId === postId ? observed.value : getCommentCountDelta(postId);
  const baseline = useRef({ postId, serverCount, delta: getCommentCountDelta(postId) });
  if (baseline.current.postId !== postId || baseline.current.serverCount !== serverCount) {
    baseline.current = { postId, serverCount, delta: getCommentCountDelta(postId) };
  }
  useEffect(() => {
    setObserved({ postId, value: getCommentCountDelta(postId) });
    const listener: Listener = (id, next) => { if (id === postId) setObserved({ postId, value: next }); };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [postId]);
  return serverCount === undefined ? delta : delta - baseline.current.delta;
}

/**
 * Thread polls API (server: api-server routes/post-polls.ts).
 *
 * Feed cards ask for their post's poll through `usePostPoll(postId)`; ids
 * requested in the same tick are fetched together with one
 * GET /api/posts/polls?ids=… call and kept in a small in-memory store so a
 * vote updates every card showing that post.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { onServicesConfigured, serviceRequest } from '@/lib/serviceConfig';
import type { PollDraft } from '@/lib/postPolls';

export interface PostPoll {
  postId: string;
  options: Array<{ text: string; votes: number | null; percent: number | null }>;
  totalVotes: number;
  durationMinutes: number;
  endsAt: string | null;
  isEnded: boolean;
  myVote: number | null;
  isAuthor: boolean;
  canVote: boolean;
  showResults: boolean;
  winner: number | null;
}

/** undefined = not loaded yet, null = this post has no poll. */
type Entry = PostPoll | null | undefined;

const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const MAX_BATCH = 50;
/** Bumped when the signed-in account changes; a fetch from before it is dropped. */
let generation = 0;

function emit() { for (const l of listeners) l(); }

export function setCachedPoll(postId: string, poll: PostPoll | null) {
  store.set(postId, poll);
  emit();
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending.clear();
  const startedIn = generation;
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const chunk = ids.slice(i, i + MAX_BATCH);
    try {
      const res = await getPolls(chunk);
      // Another account signed in meanwhile: these results carry the previous
      // viewer's vote (myVote / canVote), so they are not stored.
      if (generation !== startedIn) return;
      for (const id of chunk) store.set(id, res[id] ?? null);
    } catch {
      if (generation !== startedIn) return;
      // Leave them unloaded; the next mount retries. A poll never blocks the post.
      for (const id of chunk) store.delete(id);
    }
  }
  emit();
}

/**
 * Polls carry the viewer's own state (myVote, canVote, isAuthor), so the
 * cache belongs to one account: on sign-in / sign-out / account switch every
 * cached poll is dropped and the ones on screen are fetched again.
 */
function resetForAccountChange() {
  generation += 1;
  const shown = [...store.keys()];
  store.clear();
  for (const id of shown) request(id);
  emit();
}
try {
  onServicesConfigured(resetForAccountChange);
} catch {
  // Narrowly-mocked tests stub serviceConfig without this hook.
}

function request(postId: string) {
  if (store.has(postId) || pending.has(postId)) return;
  pending.add(postId);
  timer ??= setTimeout(() => { void flush(); }, 30);
}


/** The poll on this post (undefined while loading, null when there is none). */
export function usePostPoll(postId: string | null | undefined): Entry {
  const valid = !!postId;
  useEffect(() => { if (valid) request(postId!); }, [valid, postId]);
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => (valid ? store.get(postId!) : null),
    () => (valid ? store.get(postId!) : null),
  );
}

export async function getPolls(ids: string[]): Promise<Record<string, PostPoll>> {
  if (ids.length === 0) return {};
  const res = await serviceRequest<{ polls: Record<string, PostPoll> }>(
    `/api/posts/polls?ids=${ids.map(encodeURIComponent).join(',')}`, {}, false,
  );
  return res.polls ?? {};
}

export async function savePostPoll(postId: string, draft: PollDraft): Promise<PostPoll> {
  const res = await serviceRequest<{ poll: PostPoll }>(`/api/posts/${encodeURIComponent(postId)}/poll`, {
    method: 'PUT',
    body: JSON.stringify({ options: draft.options, durationMinutes: draft.durationMinutes }),
  });
  setCachedPoll(postId, res.poll);
  return res.poll;
}

/**
 * Votes, then stores the returned results. On "already voted" / "ended" the
 * server sends the current poll back, which is stored too.
 */
export async function voteInPoll(postId: string, optionIndex: number): Promise<PostPoll> {
  try {
    const res = await serviceRequest<{ poll: PostPoll }>(`/api/posts/${encodeURIComponent(postId)}/poll/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIndex }),
    }, false);
    setCachedPoll(postId, res.poll);
    return res.poll;
  } catch (error) {
    const body = (error as { body?: string } | null)?.body;
    try {
      const parsed = body ? JSON.parse(body) : null;
      if (parsed?.poll) { setCachedPoll(postId, parsed.poll); return parsed.poll; }
    } catch { /* fall through */ }
    throw error;
  }
}

/** Test hook. */
export function __resetPollStore() { store.clear(); pending.clear(); if (timer) clearTimeout(timer); timer = null; }

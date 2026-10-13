/**
 * Attaches the composer's poll to a Thread right after it is created
 * (PUT /api/posts/:id/poll). The Thread itself is already saved at this
 * point, so a poll failure must not fail the post (Retry would publish a
 * second copy): it is retried once, then reported without throwing.
 */
import { Alert } from 'react-native';
import { cleanPollDraft, type PollDraft } from '@/lib/postPolls';
import { savePostPoll } from '@/services/postPollService';

export async function attachThreadPoll<T extends { id?: string | null }>(
  post: T,
  draft: PollDraft | null | undefined,
  save: (postId: string, poll: PollDraft) => Promise<unknown> = savePostPoll,
  report: () => void = () => Alert.alert('Poll not added', "Your thread was posted, but its poll couldn't be added."),
): Promise<T> {
  const poll = cleanPollDraft(draft);
  const id = post?.id;
  if (!poll || !id) return post;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await save(id, poll);
      return post;
    } catch { /* retry once */ }
  }
  report();
  return post;
}

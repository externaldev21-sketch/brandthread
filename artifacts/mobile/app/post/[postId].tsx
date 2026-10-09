/**
 * Universal-link target for the long-form post link /post/{postId} — same
 * destination as /p/{postId} (see app/p/[postId].tsx).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function PostLongLinkRedirect() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();

  useEffect(() => {
    const target = postId ? parseShareLink(`/post/${encodeURIComponent(postId)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [postId, router]);

  return null;
}

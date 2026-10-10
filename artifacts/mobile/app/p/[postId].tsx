/**
 * Universal-link target for shared posts.
 *
 * Route: /p/[postId]  (https://brandthread.app/p/{postId}, built by
 * lib/shareLinks.ts buildPostUrl). The post viewer already renders from
 * `?postId=`, so this only forwards the param and renders nothing.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function PostLinkRedirect() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();

  useEffect(() => {
    const target = postId ? parseShareLink(`/p/${encodeURIComponent(postId)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [postId, router]);

  return null;
}

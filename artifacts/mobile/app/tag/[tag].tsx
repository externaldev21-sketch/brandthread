/**
 * Universal-link target for shared hashtags: https://brandthread.app/tag/{tag}.
 * Forwards to the hashtag page route `/hashtag/[tag]`; renders nothing.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function HashtagLinkRedirect() {
  const router = useRouter();
  const { tag } = useLocalSearchParams<{ tag: string }>();

  useEffect(() => {
    const target = tag ? parseShareLink(`/tag/${encodeURIComponent(tag)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [tag, router]);

  return null;
}

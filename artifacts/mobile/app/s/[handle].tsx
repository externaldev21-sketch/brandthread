/**
 * Universal-link target for the short store link /s/{handle} — opens the same
 * profile/storefront as /store/{handle} (lib/shareLinks.ts parseShareLink).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function StoreShortLinkRedirect() {
  const router = useRouter();
  const { handle } = useLocalSearchParams<{ handle: string }>();

  useEffect(() => {
    const target = handle ? parseShareLink(`/s/${encodeURIComponent(handle)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [handle, router]);

  return null;
}

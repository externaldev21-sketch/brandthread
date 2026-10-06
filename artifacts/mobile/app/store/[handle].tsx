/**
 * Universal-link target for shared stores: https://brandthread.app/store/{handle}
 * (the URL share-store.tsx already hands out). A store's handle is the
 * seller's username, so this forwards to the public profile route /u/[username],
 * which resolves seller profiles. Product links (/store/product/{id}) are
 * handled by the more specific store/product route.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function StoreLinkRedirect() {
  const router = useRouter();
  const { handle } = useLocalSearchParams<{ handle: string }>();

  useEffect(() => {
    if (!handle) return;
    router.replace((`/u/${encodeURIComponent(String(handle).toLowerCase())}`) as never);
  }, [handle, router]);

  return null;
}

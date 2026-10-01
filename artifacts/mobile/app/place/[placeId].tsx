/**
 * Universal-link target for shared places: https://brandthread.app/place/{id}.
 * Forwards to the location page route `/location/[placeId]`; renders nothing.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseShareLink } from '@/lib/shareLinks';

export default function PlaceLinkRedirect() {
  const router = useRouter();
  const { placeId } = useLocalSearchParams<{ placeId: string }>();

  useEffect(() => {
    const target = placeId ? parseShareLink(`/place/${encodeURIComponent(placeId)}`) : null;
    router.replace((target?.href ?? '/') as never);
  }, [placeId, router]);

  return null;
}

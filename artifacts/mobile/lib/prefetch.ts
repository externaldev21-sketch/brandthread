/**
 * Press-in prefetching. RN fires onPressIn ~100-200ms before onPress (the
 * user's finger lands before they lift it), so kicking off the next screen's
 * data fetch and hero image decode there — instead of waiting for
 * navigation to mount the destination screen — makes the transition feel
 * instant instead of triggering a fresh network waterfall after the tap.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { Image } from 'expo-image';

/** Warm the query cache for a destination screen. Safe to call repeatedly —
 *  TanStack Query dedupes in-flight fetches for the same key and skips the
 *  fetch entirely if the entry is still fresh. */
export function prefetchQuery<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  staleTime?: number,
): void {
  void queryClient.prefetchQuery({ queryKey, queryFn, staleTime });
}

/** Warm expo-image's memory/disk cache for a URI so the destination screen's
 *  hero image is already decoded by the time it mounts. */
export function prefetchImage(uri: string | null | undefined): void {
  if (!uri) return;
  void Image.prefetch(uri, { cachePolicy: 'memory-disk' });
}

/** Combine a query + image prefetch into one press-in handler. */
export function prefetchOnPressIn<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  imageUri?: string | null,
): () => void {
  return () => {
    prefetchQuery(queryClient, queryKey, queryFn);
    if (imageUri) prefetchImage(imageUri);
  };
}

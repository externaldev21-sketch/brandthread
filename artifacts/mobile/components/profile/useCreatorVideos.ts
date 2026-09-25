import { useCallback, useEffect, useRef, useState } from 'react';
import { getCreatorVideosPage } from '@/services/profileService';
import type { SellerThreadPost } from '@/services/socialService';

export interface CreatorVideosState {
  posts: SellerThreadPost[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  hasMore: boolean;
  restricted: 'friends_only' | null;
  reload: (opts?: { fresh?: boolean }) => Promise<void>;
  loadMore: () => void;
}

/**
 * Paged creator videos for a profile grid. `userId` null = not resolved yet
 * (stays in the loading state — never an error, never a spinner forever:
 * callers resolve the id or show their own error state).
 */
export function useCreatorVideos(userId: string | null | undefined, opts: { fresh?: boolean } = {}): CreatorVideosState {
  const [posts, setPosts] = useState<SellerThreadPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [restricted, setRestricted] = useState<'friends_only' | null>(null);
  const offsetRef = useRef(0);
  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const fresh = !!opts.fresh;

  const reload = useCallback(async (reloadOpts: { fresh?: boolean } = {}) => {
    if (!userId) return;
    const generation = ++generationRef.current;
    setError(false);
    try {
      const page = await getCreatorVideosPage(userId, 0, undefined, { fresh: fresh || reloadOpts.fresh });
      if (generation !== generationRef.current) return;
      setPosts(page.posts);
      setTotal(page.total);
      setHasMore(page.hasMore);
      setRestricted(page.restricted);
      offsetRef.current = page.nextOffset;
    } catch {
      if (generation !== generationRef.current) return;
      setError(true);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [userId, fresh]);

  useEffect(() => {
    setPosts([]);
    setTotal(0);
    setHasMore(false);
    setRestricted(null);
    setLoading(true);
    offsetRef.current = 0;
    void reload();
  }, [reload]);

  const loadMore = useCallback(() => {
    if (!userId || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const generation = generationRef.current;
    getCreatorVideosPage(userId, offsetRef.current, undefined, { fresh })
      .then((page) => {
        if (generation !== generationRef.current) return;
        setPosts((prev) => {
          const seen = new Set(prev.map((post) => post.id));
          return [...prev, ...page.posts.filter((post) => !seen.has(post.id))];
        });
        setHasMore(page.hasMore);
        offsetRef.current = page.nextOffset;
      })
      .catch(() => { /* keep the cursor; the next scroll retries */ })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [userId, hasMore, fresh]);

  return { posts, total, loading, loadingMore, error, hasMore, restricted, reload, loadMore };
}

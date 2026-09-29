/**
 * useQueryResult — shared three-state async read primitive.
 *
 * Money/analytics screens were rendering the same blank/zero UI whether a
 * fetch genuinely returned nothing or the fetch itself failed, so a real
 * outage looked identical to "you have $0 / 0 orders / 0 views." This hook
 * gives every read call one honest shape instead of each screen inventing
 * its own loading/error booleans:
 *
 *   - 'loading'     initial fetch (or a retry) in flight, nothing to show yet
 *   - 'loaded'      fetch succeeded and there is data to render
 *   - 'empty'       fetch succeeded and the result is genuinely nothing
 *                   (empty list, or a `0`/no-value the caller marks empty
 *                   via `isEmpty`) — a REAL empty state, not a failure
 *   - 'unavailable' fetch failed — NEVER render zero/blank for this state;
 *                   render the shared <RetryRow/> instead
 *
 * `loaded` vs `empty` is decided by an optional `isEmpty(data)` predicate
 * (defaults to "falsy or empty array/string"). Screens that need to keep a
 * genuine tracked `0` distinct from an untracked value (analytics counts)
 * should carry that distinction inside `T` itself (see post-analytics.tsx's
 * `{ tracked, count }` convention) rather than relying on `isEmpty`.
 *
 * Usage:
 *   const balance = useQueryResult(() => api.wallet.balance(), [api]);
 *   if (balance.status === 'unavailable') return <RetryRow label="Couldn't load balance" onRetry={balance.retry} />;
 *   if (balance.status === 'loading') return <Skeleton .../>;
 *   return <Text>{formatCents(balance.data.cents)}</Text>;
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type QueryResult<T> =
  | { status: 'loading'; data: undefined; error: undefined; retry: () => void }
  | { status: 'loaded'; data: T; error: undefined; retry: () => void }
  | { status: 'empty'; data: T; error: undefined; retry: () => void }
  | { status: 'unavailable'; data: undefined; error: unknown; retry: () => void };

export interface UseQueryResultOptions<T> {
  /** Skip the fetch entirely (e.g. no id yet). Leaves status at 'loading'. */
  enabled?: boolean;
  /** Decide whether a successful result counts as 'empty' rather than 'loaded'. */
  isEmpty?: (data: T) => boolean;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Runs `fetcher` and tracks it as one of four states — never collapses a
 * failure into an empty/zero success. Re-runs whenever `deps` changes, and
 * exposes `retry()` for the shared retry row to call.
 */
export function useQueryResult<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  options?: UseQueryResultOptions<T>,
): QueryResult<T> {
  const enabled = options?.enabled ?? true;
  const isEmpty = options?.isEmpty ?? (defaultIsEmpty as (data: T) => boolean);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'loaded'; data: T } | { status: 'unavailable'; error: unknown }
  >({ status: 'loading' });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const generation = useRef(0);

  const run = useCallback(() => {
    if (!enabled) return;
    const gen = ++generation.current;
    setState({ status: 'loading' });
    fetcherRef.current()
      .then((data) => {
        if (generation.current === gen) setState({ status: 'loaded', data });
      })
      .catch((error) => {
        if (generation.current === gen) setState({ status: 'unavailable', error });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const retry = useCallback(() => run(), [run]);

  if (state.status === 'loading') return { status: 'loading', data: undefined, error: undefined, retry };
  if (state.status === 'unavailable') return { status: 'unavailable', data: undefined, error: state.error, retry };
  return isEmpty(state.data)
    ? { status: 'empty', data: state.data, error: undefined, retry }
    : { status: 'loaded', data: state.data, error: undefined, retry };
}

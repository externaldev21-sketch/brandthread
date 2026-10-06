/**
 * usePullToRefresh — wires a screen's EXISTING reload function to the shared
 * ThemedRefreshControl. Keeps a `refreshing` flag that is separate from the
 * screen's initial-loading state, so pulling never brings the first-load
 * skeleton back. Pass `refreshControl` straight to a FlatList/ScrollView.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ThemedRefreshControl } from '@/components/ui/ThemedRefreshControl';

const MIN_SPIN_MS = 450;

export function usePullToRefresh(reload: () => unknown | Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const started = Date.now();
    try {
      await reloadRef.current();
    } catch {
      // The screen's own reload owns error handling.
    }
    const wait = MIN_SPIN_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (mounted.current) setRefreshing(false);
  }, []);

  const refreshControl = <ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />;
  return { refreshing, onRefresh, refreshControl };
}

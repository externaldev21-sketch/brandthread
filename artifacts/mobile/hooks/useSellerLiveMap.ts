/**
 * Data for the seller dashboard order globe: today's order cities, the
 * recent orders (one dot each), plus a one-shot `ping` whenever a new
 * order's city arrives over /ws/seller.
 *
 * - Preview (`?bt_preview=seller`): local data only (lib/previewLiveMap.ts),
 *   no network, no socket.
 * - Real seller: GET /api/seller/live-map/today on focus and on every socket
 *   (re)connect; the socket is open only while `enabled` (dashboard focused);
 *   while it isn't connected, the same endpoint is polled every 60s. An
 *   `order_city` event bumps today's count at once and refetches, since the
 *   event is city level only and the new dot's popover needs the order.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { subscribeStoreContext } from '@/lib/api';
import { useSellerSocket } from '@/lib/live/useSellerSocket';
import { applyOrderCity, EMPTY_LIVE_MAP, isOrderCityEvent, type LiveMapToday } from '@/lib/liveMap/liveMap';
import { previewLiveMap } from '@/lib/previewLiveMap';

const FALLBACK_POLL_MS = 60_000;

export interface LiveMapPing { key: string; seq: number }

export function useSellerLiveMap({ enabled, preview }: { enabled: boolean; preview: 'demo' | 'fresh' | null }) {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<LiveMapToday | null>(preview ? previewLiveMap(preview) : null);
  const [error, setError] = useState(false);
  const [ping, setPing] = useState<LiveMapPing | null>(null);
  const [connected, setConnected] = useState(false);
  const [storeTick, setStoreTick] = useState(0);
  const generationRef = useRef(0);
  const live = enabled && !preview && !!isLoaded && !!isSignedIn;

  const load = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const next = await api.seller.liveMapToday();
      if (generation !== generationRef.current) return;
      setData(next ?? EMPTY_LIVE_MAP);
      setError(false);
    } catch {
      if (generation !== generationRef.current) return;
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    if (preview) setData(previewLiveMap(preview));
  }, [preview]);

  useEffect(() => subscribeStoreContext(() => {
    generationRef.current += 1;
    setData(null);
    setStoreTick((t) => t + 1);
  }), []);

  useEffect(() => {
    if (live) void load();
  }, [live, load, storeTick]);

  useSellerSocket({
    enabled: live,
    resetKey: storeTick,
    onConnected: () => { void load(); },
    onStatus: setConnected,
    onEvent: (event) => {
      if (!isOrderCityEvent(event)) return;
      setData((prev) => applyOrderCity(prev ?? EMPTY_LIVE_MAP, event));
      setPing((prev) => ({ key: event.key, seq: (prev?.seq ?? 0) + 1 }));
      void load();
    },
  });

  useEffect(() => {
    if (!live || connected) return;
    const id = setInterval(() => { void load(); }, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [live, connected, load]);

  return { data, error, ping, retry: load };
}

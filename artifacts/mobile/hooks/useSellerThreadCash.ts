/**
 * Seller Thread Cash balance + history — one shared fetch used by the
 * Payouts card, the seller dashboard's earnings row, the Studio/More
 * Payouts tile, and the Thread Cash history screen, so they never drift.
 *
 * Real balance/history come from the same `GET /api/thread-cash` /
 * `GET /api/thread-cash/history` endpoints the buyer wallet uses — the
 * ledger is per-account, not per-role, so a seller's own earned entries
 * (Live gifts, message payments, cash-outs) show up the same way. Falls
 * back to the seeded preview fixture only in __DEV__ web preview when the
 * real API isn't reachable (see lib/previewSellerThreadCash.ts) — a real
 * signed-in seller with no Thread Cash yet sees an honest $0.00.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { getPreviewSellerThreadCashBalanceCents, getPreviewSellerThreadCashHistory } from '@/lib/previewSellerThreadCash';
import type { ThreadCashEntry } from '@/lib/threadCashTypes';
import { subscribeThreadCashChanged } from '@/lib/threadCashEvents';

/** Reload when any Thread Cash balance changes (either side) or the app comes back to the foreground. */
function useThreadCashRefresh(load: () => void) {
  useEffect(() => {
    const unsubscribe = subscribeThreadCashChanged(load);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    return () => { unsubscribe(); appState.remove(); };
  }, [load]);
}

export function useSellerThreadCashBalance() {
  const api = useApi();
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const status = await api.threadCash.get();
      if (generation.current === gen) setBalanceCents(status.balanceCents);
    } catch {
      if (generation.current !== gen) return;
      if (isSellerDevPreview()) {
        setBalanceCents(getPreviewSellerThreadCashBalanceCents());
      } else {
        setError(true);
      }
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  useThreadCashRefresh(load);

  return { balanceCents, loading, error, reload: load };
}

export function useSellerThreadCashHistory(limit = 50) {
  const api = useApi();
  const [history, setHistory] = useState<ThreadCashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const { history: h } = await api.threadCash.history(limit);
      if (generation.current === gen) setHistory(h);
    } catch {
      if (generation.current !== gen) return;
      if (isSellerDevPreview()) {
        setHistory(getPreviewSellerThreadCashHistory());
      } else {
        setError(true);
      }
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [api, limit]);

  useEffect(() => { void load(); }, [load]);
  useThreadCashRefresh(load);

  return { history, loading, error, reload: load };
}

/**
 * A product's draw (if it has one) and the signed-in buyer's entry, kept
 * current: reloaded when the screen regains focus and at the moments the
 * phase can change (entries open, entries close), and every 15s while the
 * buyer is waiting on a result.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import type { ProductDrawEntry, ProductDrawState } from '@/lib/api';
import { drawPhase, type DrawPhase } from '@/lib/drawPhase';

const WAITING_POLL_MS = 15_000;

export function useProductDraw(productId?: string): {
  draw: ProductDrawState | null;
  entry: ProductDrawEntry | null;
  phase: DrawPhase | null;
  reload: () => void;
} {
  const api = useApi();
  const { isSignedIn } = useAuth();
  const [draw, setDraw] = useState<ProductDrawState | null>(null);
  const [entry, setEntry] = useState<ProductDrawEntry | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(() => {
    if (!productId) return;
    api.productDraws.state(productId)
      .then((s) => {
        setSkewMs(new Date(s.serverNow).getTime() - Date.now());
        setNow(Date.now());
        setDraw(s.draw);
        if (s.draw && isSignedIn) {
          api.productDraws.entry(productId).then((r) => setEntry(r.entry)).catch(() => {});
        } else {
          setEntry(null);
        }
      })
      .catch(() => setDraw(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, isSignedIn]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const phase = draw ? drawPhase(draw, entry, now + skewMs) : null;

  // Re-evaluate exactly when entries open or close.
  useEffect(() => {
    if (!draw || draw.status !== 'open') return;
    const serverNow = Date.now() + skewMs;
    const next = [Date.parse(draw.opensAt), Date.parse(draw.closesAt)].find((t) => t > serverNow);
    if (next == null) return;
    const id = setTimeout(() => { setNow(Date.now()); if (next === Date.parse(draw.closesAt)) reload(); }, next - serverNow + 50);
    return () => clearTimeout(id);
  }, [draw, skewMs, now, reload]);

  // Waiting on the result after entries closed.
  useEffect(() => {
    if (phase?.kind !== 'entered' || !draw || Date.now() + skewMs < Date.parse(draw.closesAt)) return;
    const id = setInterval(reload, WAITING_POLL_MS);
    return () => clearInterval(id);
  }, [phase?.kind, draw, skewMs, reload]);

  return { draw, entry, phase, reload };
}

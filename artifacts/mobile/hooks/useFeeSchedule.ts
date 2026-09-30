/**
 * Fee schedule from the server, fetched once per app session and shared by
 * every fee surface. Uses the unauthenticated public endpoint so the signed-out
 * preview never touches a protected API. Returns null until loaded and when
 * unavailable — callers hide their fee UI in that case.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { parseFeeSchedule, type FeeSchedule } from '@/lib/feeSchedule';

const RETRY_AFTER_MS = 60_000;
let cached: FeeSchedule | null = null;
let inFlight: Promise<FeeSchedule | null> | null = null;
let failedAt = 0;
const listeners = new Set<() => void>();

/** Forget a failed fetch and let every mounted consumer try again. */
export function retryFeeSchedule() {
  failedAt = 0;
  listeners.forEach(fn => fn());
}

export function useFeeSchedule(): FeeSchedule | null {
  const api = useApi();
  const [schedule, setSchedule] = useState<FeeSchedule | null>(cached);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (cached) { setSchedule(cached); return; }
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;
    let alive = true;
    if (!inFlight) {
      inFlight = api.finance.feeSchedule()
        .then(raw => parseFeeSchedule(raw))
        .catch(() => null)
        .then(parsed => {
          if (parsed) cached = parsed; else failedAt = Date.now();
          inFlight = null;
          return parsed;
        });
    }
    inFlight.then(parsed => { if (alive) setSchedule(parsed); });
    return () => { alive = false; };
  }, [api, tick]);

  return schedule;
}

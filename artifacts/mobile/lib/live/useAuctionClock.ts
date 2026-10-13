import { useEffect, useState } from 'react';

/** Epoch ms refreshed every `intervalMs` while `running` (the auction countdown). */
export function useAuctionClock(running: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [running, intervalMs]);
  return now;
}

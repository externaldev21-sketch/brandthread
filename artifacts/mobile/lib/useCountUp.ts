import { useEffect, useRef, useState } from 'react';

/**
 * Animates from 0 up to `target` once, on first mount/activation, with an
 * ease-out curve — the "premium" count-up touch on the dashboard's hero
 * number and stat tiles. Returns `target` immediately when `active` is
 * false (e.g. while scrubbing the chart, where the number must track the
 * finger exactly, not animate).
 */
export function useCountUp(target: number, active: boolean, durationMs = 650): number {
  const [display, setDisplay] = useState(active ? target : 0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    startRef.current = null;
    const step = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, durationMs]);

  return active ? display : target;
}

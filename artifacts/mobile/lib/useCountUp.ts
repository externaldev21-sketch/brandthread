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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Backstop, independent of requestAnimationFrame: a backgrounded/inactive
    // tab throttles or fully suspends rAF, which would otherwise leave the
    // displayed number stuck mid-animation — disagreeing with a delta line
    // computed from the (already-correct, unanimated) target — for as long
    // as the tab stays backgrounded. This guarantees convergence to `target`
    // shortly after `durationMs` regardless of rAF starvation.
    timeoutRef.current = setTimeout(() => setDisplay(target), durationMs + 250);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current != null) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, durationMs]);

  return active ? display : target;
}

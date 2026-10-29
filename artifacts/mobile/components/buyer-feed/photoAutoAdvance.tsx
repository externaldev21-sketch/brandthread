/**
 * Optional photo-carousel auto-advance (default OFF). When the viewer turns
 * it on from the long-press options sheet, the active carousel moves to the
 * next slide every 3s — never while zoomed, held, or off-screen. A manual
 * swipe changes `index`, which restarts the timer, so swiping still works.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PHOTO_AUTO_ADVANCE_DEFAULT } from './clearMode';

export const PHOTO_AUTO_ADVANCE_KEY = 'bt:feed-photo-auto-advance:v1';
export const PHOTO_AUTO_ADVANCE_MS = 3000;

export function shouldAutoAdvance(s: { enabled: boolean; active: boolean; zoomed: boolean; holding: boolean; count: number }): boolean {
  return s.enabled && s.active && !s.zoomed && !s.holding && s.count > 1;
}
export function nextSlide(index: number, count: number): number {
  return count > 0 ? (index + 1) % count : 0;
}

let cached: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

export function usePhotoAutoAdvance(): [boolean, (v: boolean) => void] {
  const [value, setValue] = React.useState<boolean>(cached ?? PHOTO_AUTO_ADVANCE_DEFAULT);
  React.useEffect(() => {
    listeners.add(setValue);
    if (cached === null) {
      AsyncStorage.getItem(PHOTO_AUTO_ADVANCE_KEY).then((raw) => {
        // A toggle made while this read was in flight is newer than what the
        // read returned — don't let the stale stored value flip it back.
        if (cached !== null) return;
        cached = raw === '1';
        listeners.forEach((l) => l(cached as boolean));
      }).catch(() => {});
    }
    return () => { listeners.delete(setValue); };
  }, []);
  const set = React.useCallback((v: boolean) => {
    cached = v;
    listeners.forEach((l) => l(v));
    void AsyncStorage.setItem(PHOTO_AUTO_ADVANCE_KEY, v ? '1' : '0').catch(() => {});
  }, []);
  return [value, set];
}

export function PhotoAutoAdvance({ index, count, zoomed, goTo, enabled, active, holding }: {
  index: number; count: number; zoomed: boolean; goTo: (i: number) => void; enabled: boolean; active: boolean; holding: boolean;
}) {
  const goToRef = React.useRef(goTo);
  goToRef.current = goTo;
  const run = shouldAutoAdvance({ enabled, active, zoomed, holding, count });
  React.useEffect(() => {
    if (!run) return undefined;
    const t = setTimeout(() => goToRef.current(nextSlide(index, count)), PHOTO_AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [run, index, count]);
  return null;
}

/**
 * useBuyerPreferences — the signed-in buyer's saved sizes / preferences.
 *
 * Cached at module level per user id (one request shared by every mounted
 * consumer, e.g. My sizes now and the PDP size badge later). Signed-out
 * callers never touch the API and always get EMPTY_BUYER_PREFERENCES.
 *
 *   const { preferences, status, update } = useBuyerPreferences();
 *   await update({ sizes: { tops: 'M' } });   // partial merge; null clears
 *
 * status: 'signed-out' | 'loading' | 'loaded' | 'unavailable' (fetch failed;
 * `preferences` is then the last known value or empty — callers must not
 * present it as the buyer's real data, use `retry`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi, type BuyerPreferences, type BuyerPreferencesPatch } from '@/lib/api';

export const EMPTY_BUYER_PREFERENCES: BuyerPreferences = {
  sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null,
};

export type BuyerPreferencesStatus = 'signed-out' | 'loading' | 'loaded' | 'unavailable';

const cache = new Map<string, BuyerPreferences>();
const inflight = new Map<string, Promise<BuyerPreferences>>();
const listeners = new Set<(userId: string) => void>();

function publish(userId: string, value: BuyerPreferences) {
  cache.set(userId, value);
  listeners.forEach((fn) => fn(userId));
}

/** Drop the cached value (e.g. after the onboarding survey writes server-side). */
export function invalidateBuyerPreferences(userId?: string) {
  if (userId) cache.delete(userId); else cache.clear();
  inflight.clear();
  listeners.forEach((fn) => fn(userId ?? ''));
}

export function useBuyerPreferences() {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const uid = isSignedIn && userId ? userId : null;
  const [, force] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fn = (changed: string) => { if (!changed || changed === uid) force((n) => n + 1); };
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [uid]);

  const load = useCallback(async () => {
    if (!uid) return;
    setFailed(false);
    let p = inflight.get(uid);
    if (!p) {
      p = api.buyer.preferences.get();
      inflight.set(uid, p);
    }
    try {
      const value = await p;
      publish(uid, value);
    } catch {
      setFailed(true);
    } finally {
      if (inflight.get(uid) === p) inflight.delete(uid);
    }
  }, [api, uid]);

  useEffect(() => {
    if (uid && !cache.has(uid)) void load();
  }, [uid, load]);

  const update = useCallback(async (patch: BuyerPreferencesPatch): Promise<BuyerPreferences> => {
    if (!uid) throw new Error('Sign in to save your preferences.');
    const saved = await api.buyer.preferences.update(patch);
    publish(uid, saved);
    return saved;
  }, [api, uid]);

  const cached = uid ? cache.get(uid) : undefined;
  const status: BuyerPreferencesStatus = !uid ? 'signed-out' : cached ? 'loaded' : failed ? 'unavailable' : 'loading';
  return { preferences: cached ?? EMPTY_BUYER_PREFERENCES, status, update, retry: load };
}

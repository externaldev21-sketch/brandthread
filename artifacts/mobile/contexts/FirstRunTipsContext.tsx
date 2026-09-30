/**
 * Global controller for the reusable <FirstRunTip> system.
 *
 * Owns:
 *  - The account's seen-tips / skip-all state (local cache, synced from the
 *    server once on mount — see lib/firstRunTips/storage.ts).
 *  - The single global "is a tip currently showing" gate, so two tips never
 *    stack: a screen that would show a tip while another is still
 *    showing/dismissing is simply skipped (no queueing complexity — the next
 *    screen visit shows it instead).
 *  - Dev's `&tips=1` preview-testing override, which forces every tip to
 *    read as unseen.
 *
 * Mounted once near the root (app/_layout.tsx), inside the Clerk/auth
 * providers so it can read the signed-in user id.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import {
  FirstRunTipsLocalState,
  markTipSeen,
  readLocalFirstRunTipsState,
  replayAllTips,
  setSkipAllTips,
  syncFirstRunTipsFromServer,
} from '@/lib/firstRunTips/storage';

interface FirstRunTipsContextValue {
  /** Loading the initial server reconcile — screens should not gate on this (local cache is already usable). */
  ready: boolean;
  hasSeen: (tipId: string) => boolean;
  skipAll: boolean;
  /** Global "a tip is currently on screen" lock. Returns true if this tipId won the lock. */
  claim: (tipId: string) => boolean;
  release: (tipId: string) => void;
  activeTipId: string | null;
  markSeen: (tipId: string) => void;
  setSkipAllTips: () => void;
  replayTips: () => Promise<void>;
}

const FirstRunTipsContext = createContext<FirstRunTipsContextValue | null>(null);

export function FirstRunTipsProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const api = useApi();

  const [state, setState] = useState<FirstRunTipsLocalState>({ seenIds: new Set(), skipAll: false });
  const [ready, setReady] = useState(false);
  const [activeTipId, setActiveTipId] = useState<string | null>(null);
  const activeTipRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    // Paint instantly from the local cache, then reconcile with the server
    // (source of truth) without blocking anything on the network round-trip.
    readLocalFirstRunTipsState(userId).then((local) => { if (active) setState(local); });
    if (userId) {
      syncFirstRunTipsFromServer(userId, api).then((synced) => { if (active) { setState(synced); setReady(true); } });
    } else {
      setReady(true);
    }
    return () => { active = false; };
  }, [userId, api]);

  // Pure account state only — the preview/&tips=1 override lives in
  // useFirstRunTip itself (see that file for why: it needs to react to
  // Expo Router's client-side navigation, and this provider sits above the
  // router's own context and never re-renders on a route change).
  const hasSeen = useCallback((tipId: string) => {
    if (state.skipAll) return true;
    return state.seenIds.has(tipId);
  }, [state]);

  const claim = useCallback((tipId: string) => {
    if (activeTipRef.current !== null && activeTipRef.current !== tipId) return false;
    activeTipRef.current = tipId;
    setActiveTipId(tipId);
    return true;
  }, []);

  const release = useCallback((tipId: string) => {
    if (activeTipRef.current === tipId) {
      activeTipRef.current = null;
      setActiveTipId(null);
    }
  }, []);

  const markSeen = useCallback((tipId: string) => {
    setState((current) => markTipSeen(userId, tipId, current, api));
  }, [userId, api]);

  const doSkipAll = useCallback(() => {
    setState((current) => setSkipAllTips(userId, current, api));
  }, [userId, api]);

  const replayTips = useCallback(async () => {
    const reset = await replayAllTips(userId, api);
    setState(reset);
  }, [userId, api]);

  const value = useMemo<FirstRunTipsContextValue>(() => ({
    ready,
    hasSeen,
    skipAll: state.skipAll,
    claim,
    release,
    activeTipId,
    markSeen,
    setSkipAllTips: doSkipAll,
    replayTips,
  }), [ready, hasSeen, state.skipAll, claim, release, activeTipId, markSeen, doSkipAll, replayTips]);

  return <FirstRunTipsContext.Provider value={value}>{children}</FirstRunTipsContext.Provider>;
}

export function useFirstRunTipsController(): FirstRunTipsContextValue {
  const ctx = useContext(FirstRunTipsContext);
  if (!ctx) {
    throw new Error('useFirstRunTipsController must be used within a FirstRunTipsProvider');
  }
  return ctx;
}

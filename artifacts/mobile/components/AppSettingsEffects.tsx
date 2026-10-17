/**
 * Applies the account's app settings app-wide (mounted once in the root
 * layout):
 *  - pulls the server copy (/api/me/settings) into local storage once per
 *    signed-in account, so a change made on another device shows up here;
 *  - Reduce motion: forces every Reanimated animation into its reduced form
 *    (on top of the OS setting, which is always honoured);
 *  - Save login info: keeps the Clerk token cache in step with the toggle.
 * High contrast and upload quality read the same settings snapshot directly
 * (hooks/useColors.ts, lib/buyerSettings.ts uploadQuality()).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { getBuyerSettingsSnapshot, loadBuyerSettings, subscribeBuyerSettings } from '@/lib/buyerSettings';
import { hydrateBuyerSettings } from '@/lib/buyerSettingsSync';
import { setSaveLoginInfo } from '@/lib/tokenCache';
import { runAfterFirstPaint } from '@/lib/deferStartup';

export function AppSettingsEffects() {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const [reduceMotion, setReduceMotion] = useState(getBuyerSettingsSnapshot().reduceMotion);
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    void loadBuyerSettings().then((s) => {
      setReduceMotion(s.reduceMotion);
      void setSaveLoginInfo(s.saveLoginInfo);
    });
    return subscribeBuyerSettings((s) => {
      setReduceMotion(s.reduceMotion);
      void setSaveLoginInfo(s.saveLoginInfo);
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn || !userId || hydratedFor.current === userId) return;
    // Deferred past first paint — nothing on the first screen needs it.
    return runAfterFirstPaint(() => {
      if (hydratedFor.current === userId) return;
      hydratedFor.current = userId;
      hydrateBuyerSettings(api).catch((err) => {
        // Settings screens re-fetch and show their own retry; here the local
        // copy simply stays in effect until the next launch.
        hydratedFor.current = null;
        if (__DEV__) console.warn('[settings] server settings sync failed', err);
      });
    });
  }, [api, isSignedIn, userId]);

  return reduceMotion ? <ReducedMotionConfig mode={ReduceMotion.Always} /> : null;
}

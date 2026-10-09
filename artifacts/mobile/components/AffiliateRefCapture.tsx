import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import {
  affiliateVisitorId, clearPendingAffiliateCode, parseAffiliateCode, readPendingAffiliateCode, savePendingAffiliateCode,
} from '@/lib/affiliateRef';

/**
 * Renders nothing. Watches for a creator's ?aff=CODE link, records the click,
 * and attaches the code to the signed-in account. No-op without an aff code, so
 * it never calls the API in normal use (and never while signed out, apart from
 * the public click beacon).
 */
export function AffiliateRefCapture() {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const url = Linking.useURL();
  const attachedFor = useRef<string | null>(null);

  useEffect(() => {
    const webUrl = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : null;
    const code = parseAffiliateCode(url) ?? parseAffiliateCode(webUrl);
    if (!code) return;
    let cancelled = false;
    void (async () => {
      if ((await readPendingAffiliateCode()) === code) return;
      await savePendingAffiliateCode(code);
      if (cancelled) return;
      try { await api.affiliate.click(code, await affiliateVisitorId()); } catch { /* public beacon, best effort */ }
    })();
    return () => { cancelled = true; };
  }, [url, api]);

  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    void (async () => {
      const code = await readPendingAffiliateCode();
      if (!code || cancelled || attachedFor.current === `${userId}:${code}`) return;
      attachedFor.current = `${userId}:${code}`;
      try {
        await api.affiliate.attach(code);
        await clearPendingAffiliateCode();
      } catch {
        attachedFor.current = null; // try again next time the app opens
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn, userId, url, api]);

  return null;
}

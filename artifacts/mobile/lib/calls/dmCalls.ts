/**
 * Which calling path a 1:1 DM (buyer-conversation / seller-conversation)
 * uses — the one place that decides it, so the two screens can't drift.
 *
 *  - 'simulated' — the preview-only CallSessionContext flow
 *    (lib/calls/previewCallProvider.ts). Only for the `&demo=1` web preview,
 *    where there is no account and no second device to ring.
 *  - 'agora'     — the real call: app/call-screen.tsx (Agora RTC, token from
 *    POST /api/call/token, which already authorizes DM participants) plus
 *    POST /api/call/dm/ring so the other person is actually notified.
 *    Native only, and only once the server reports calling is configured
 *    (AGORA_APP_ID + AGORA_APP_CERTIFICATE).
 *  - 'hidden'    — anything else (web outside the demo preview, fresh
 *    preview, native without Agora credentials): no call buttons at all,
 *    never a fake call.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { isPreviewDemoMode, isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { getCallAvailability } from '@/services/manufacturerOrderFlow';

import { resolveDmCallRoute, type DmCallRoute } from './dmCallLinks';

export { dmCallScreenHref, dmCallModeFromType, resolveDmCallRoute, type DmCallRoute } from './dmCallLinks';

/**
 * Resolves the route for the current session. Starts 'hidden' on native
 * until GET /api/call/availability answers, so a button never flashes in and
 * then disappears. Never calls the API in a web preview (signed out).
 */
export function useDmCallRoute(): DmCallRoute {
  const demo = isPreviewDemoMode();
  const preview = isBuyerDevPreview() || isSellerDevPreview();
  const needsServer = !demo && !preview && Platform.OS !== 'web';
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    if (!needsServer) return undefined;
    let cancelled = false;
    void getCallAvailability().then((ok) => { if (!cancelled) setConfigured(ok); });
    return () => { cancelled = true; };
  }, [needsServer]);

  return resolveDmCallRoute({ demo, preview, platform: Platform.OS, configured });
}

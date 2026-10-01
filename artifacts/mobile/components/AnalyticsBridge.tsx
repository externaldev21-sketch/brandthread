import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useCanUseAnalytics } from '@/contexts/CookieConsentContext';
import { useRole } from '@/contexts/RoleContext';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { analyticsAllowed } from '@/lib/analytics/gate';
import { identifyAnalyticsUser, isAnalyticsEnabled, setAnalyticsConsent, setAnalyticsPlatform, setAnalyticsSuppressed, track } from '@/lib/analytics';
import { setMonitoringRole } from '@/lib/monitoring';

/**
 * Renders nothing. Keeps analytics in step with consent, the signed-in
 * account (opaque id only) and preview sessions, fires `app_opened` once per
 * launch, and tags crash reports with the account role (no id, name or email).
 * Mounted once inside RootLayoutNav.
 */
export default function AnalyticsBridge() {
  const webConsent = useCanUseAnalytics();
  const { isSignedIn, userId } = useAuth();
  const { role } = useRole();
  const opened = useRef(false);

  const previewSession = Platform.OS === 'web' && (isBuyerDevPreview() || isSellerDevPreview());
  const { consent, suppressed } = analyticsAllowed({
    platform: Platform.OS,
    webAnalyticsConsent: webConsent,
    previewSession,
    devBypass: DEV_BYPASS_ROLE !== null,
  });

  useEffect(() => {
    setAnalyticsPlatform(Platform.OS);
    setAnalyticsSuppressed(suppressed);
    setAnalyticsConsent(consent);
    identifyAnalyticsUser(isSignedIn && userId ? userId : null);
    if (consent && !suppressed && isAnalyticsEnabled() && !opened.current) {
      opened.current = true;
      track('app_opened', { platform: Platform.OS });
    }
  }, [consent, suppressed, isSignedIn, userId]);

  useEffect(() => {
    setMonitoringRole(isSignedIn ? role : null);
  }, [isSignedIn, role]);

  return null;
}

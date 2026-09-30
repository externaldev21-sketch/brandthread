/**
 * OfflineBanner — a slim, solid pill shown ONLY while the device is actually
 * offline (hooks/useIsOffline). Absolutely positioned below the top safe-area
 * inset so it never shifts layout and never sits under the notch; it
 * auto-dismisses when the connection returns. "Retry" re-checks connectivity
 * and re-runs the currently failed reads (lib/networkNotice.ts retry
 * registry + any errored TanStack queries).
 *
 * Distinct from the intentionally-empty NetworkNoticeBanner: that one reacted
 * to page-read failures (incl. server 5xx); this never does.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { recheckConnectivity, useIsOffline } from '@/hooks/useIsOffline';
import { PressableScale } from '@/components/BrandthreadUI';
import { queryClient } from '@/lib/queryClient';
import { retryNetworkNotice } from '@/lib/networkNotice';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export default function OfflineBanner() {
  const offline = useIsOffline();
  const { theme } = useAppTheme();
  const top = useHeaderTopInset();
  const [retrying, setRetrying] = useState(false);

  const onRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const stillOffline = await recheckConnectivity();
      if (!stillOffline) {
        await Promise.allSettled([
          retryNetworkNotice(),
          queryClient.refetchQueries({ predicate: (q) => q.state.status === 'error' }),
        ]);
      }
    } finally {
      setRetrying(false);
    }
  }, [retrying]);

  if (!offline) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: top + SPACING.xxs }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="offline-banner"
        style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <Feather name="wifi-off" size={14} color={theme.text} />
        <Text style={[TYPE_SCALE.footnote, styles.text, { color: theme.text }]} numberOfLines={1}>
          You're offline
        </Text>
        <PressableScale
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          testID="offline-banner-retry"
          noMinHeight
          style={styles.retry}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={theme.muted} />
          ) : (
            <Text style={[TYPE_SCALE.footnote, styles.retryText, { color: theme.text }]}>Retry</Text>
          )}
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    height: 32,
    paddingLeft: SPACING.sm,
    paddingRight: SPACING.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  text: { fontFamily: FONT.medium },
  retry: { paddingHorizontal: SPACING.xs, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: FONT.semibold },
});

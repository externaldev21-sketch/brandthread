import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  BORDER,
  FONT,
  FS,
  RED,
  RADIUS,
  SP,
} from '@/lib/theme';

export interface ConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: string;
  verified: boolean;
  bankLast4: string | null;
}

export function normalizeConnectStatus(data: unknown): ConnectStatus | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  return {
    connected: value.connected === true,
    chargesEnabled: value.chargesEnabled === true,
    payoutsEnabled: value.payoutsEnabled === true,
    status: typeof value.status === 'string' && value.status.trim() ? value.status : 'unknown',
    verified: value.verified === true,
    bankLast4: typeof value.bankLast4 === 'string' && /^\d{4}$/.test(value.bankLast4)
      ? value.bankLast4
      : null,
  };
}

type StripeConnectWarningProps = {
  /** Supplying this lets a screen share its live status with related Connect UI. */
  connectStatus?: ConnectStatus | null;
  onConnect?: () => Promise<void>;
  isConnecting?: boolean;
};

/**
 * Shows the seller's Stripe Connect setup warning wherever seller money
 * actions are surfaced. The status is refreshed when the screen regains focus
 * so returning from Stripe onboarding reflects the latest account state.
 */
export default function StripeConnectWarning({
  connectStatus: providedStatus,
  onConnect,
  isConnecting = false,
}: StripeConnectWarningProps) {
  const api = useApi();
  const { theme } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const useLargeTextLayout = width < 402 || fontScale >= 1.3;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [localStatus, setLocalStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const isRefreshing = useRef(false);
  const connectStatus = providedStatus === undefined ? localStatus : providedStatus;

  const refreshConnectStatus = useCallback(async () => {
    if (providedStatus !== undefined || isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      const data: any = await api.seller.connect.status();
      setLocalStatus(normalizeConnectStatus(data));
    } catch {
      setLocalStatus(null);
    } finally {
      isRefreshing.current = false;
    }
  }, [api, providedStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshConnectStatus();
    }, [refreshConnectStatus]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshConnectStatus();
    });
    return () => subscription.remove();
  }, [refreshConnectStatus]);

  const handleFixStripeConnect = async () => {
    if (loading || isConnecting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (onConnect) {
      await onConnect();
      return;
    }
    setLoading(true);
    try {
      const data = await api.seller.connect.onboard();
      if (!data || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
        Alert.alert('Onboarding unavailable', 'Stripe did not provide a valid onboarding link. Please try again.');
        return;
      }
      const canOpen = await Linking.canOpenURL(data.url);
      if (!canOpen) throw new Error('Unable to open onboarding link');
      await Linking.openURL(data.url);
    } catch {
      Alert.alert('Error', 'Could not open Stripe onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (
    connectStatus === null
    || (
      connectStatus.connected
      && connectStatus.chargesEnabled
      && connectStatus.payoutsEnabled
      && connectStatus.status === 'active'
    )
  ) return null;

  return (
    <TouchableOpacity
      style={[styles.connectBanner, useLargeTextLayout && styles.connectBannerLargeText]}
      onPress={handleFixStripeConnect}
      activeOpacity={0.85}
      disabled={loading || isConnecting}
      accessibilityRole="button"
      accessibilityLabel="Fix Stripe Connect setup"
    >
      <View style={styles.connectBannerMain}>
        <View style={styles.connectBannerIcon}>
          <Feather name="alert-circle" size={20} color={RED} />
        </View>
        <View style={styles.message}>
          <Text style={styles.connectBannerTitle} maxFontSizeMultiplier={2}>
            {connectStatus.connected
              ? 'Payments restricted — fix your Stripe account'
              : 'Payments unavailable — connect Stripe to get paid'}
          </Text>
          <Text style={styles.connectBannerSub} maxFontSizeMultiplier={2}>
            {connectStatus.connected
              ? 'Buyers can\'t checkout until Stripe verifies your account. Tap to complete setup.'
              : 'Your store is live but buyers can\'t pay yet. Tap to connect Stripe.'}
          </Text>
        </View>
      </View>
      <View
        style={[styles.connectBannerArrow, useLargeTextLayout && styles.connectBannerArrowLargeText]}
        testID="stripe-connect-warning-action"
      >
        {loading || isConnecting
          ? <Text style={styles.opening} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={2}>Opening…</Text>
          : <>
              <Text style={styles.connectBannerFix} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={2}>Fix Now</Text>
              <Feather name="chevron-right" size={14} color={RED} />
            </>}
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (theme: { accent: string; accentDim: string; onAccent: string }) => StyleSheet.create({
  connectBanner: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    backgroundColor: theme.accentDim,
    borderRadius: RADIUS.md,
    padding: SP.md,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  connectBannerLargeText: {
    flexDirection: 'column',
  },
  connectBannerMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
  },
  connectBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    minWidth: 0,
  },
  connectBannerTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.accent,
    marginBottom: 3,
  },
  connectBannerSub: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.onAccent === '#FFFFFF' ? theme.accent : RED,
    lineHeight: 16,
  },
  connectBannerArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
    minHeight: 36,
  },
  connectBannerArrowLargeText: {
    alignSelf: 'flex-end',
    minHeight: 0,
  },
  connectBannerFix: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    color: RED,
  },
  opening: {
    fontSize: 11,
    color: RED,
    fontFamily: FONT.medium,
  },
});
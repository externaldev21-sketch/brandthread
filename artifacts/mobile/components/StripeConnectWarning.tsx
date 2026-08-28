import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BORDER,
  FONT,
  FS,
  RED,
  RADIUS,
  SP,
} from '@/lib/theme';

interface ConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: string;
}

/**
 * Shows the seller's Stripe Connect setup warning wherever seller money
 * actions are surfaced. The status is refreshed when the screen regains focus
 * so returning from Stripe onboarding reflects the latest account state.
 */
export default function StripeConnectWarning() {
  const api = useApi();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const connectStatusRef = useRef<string | null>(null);

  const refreshConnectStatus = useCallback(async () => {
    if (connectStatusRef.current === 'active') return;

    try {
      const data: any = await api.seller.connect.status();
      if (data && typeof data === 'object') {
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        connectStatusRef.current = status;
        setConnectStatus({
          connected: !!data.connected,
          chargesEnabled: !!data.chargesEnabled,
          payoutsEnabled: !!data.payoutsEnabled,
          status,
        });
      }
    } catch {
      // Don't show a warning when the account status cannot be determined.
      connectStatusRef.current = null;
      setConnectStatus(null);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      refreshConnectStatus();
    }, [refreshConnectStatus]),
  );

  const handleFixStripeConnect = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const data = await api.seller.connect.onboard();
      if (data?.url) {
        await Linking.openURL(data.url);
      }
    } catch {
      Alert.alert('Error', 'Could not open Stripe onboarding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (connectStatus === null || connectStatus.status === 'active') return null;

  return (
    <TouchableOpacity
      style={styles.connectBanner}
      onPress={handleFixStripeConnect}
      activeOpacity={0.85}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel="Fix Stripe Connect setup"
    >
      <View style={styles.connectBannerIcon}>
        <Feather name="alert-circle" size={20} color={RED} />
      </View>
      <View style={styles.message}>
        <Text style={styles.connectBannerTitle}>
          {connectStatus.connected
            ? 'Payments restricted — fix your Stripe account'
            : 'Payments unavailable — connect Stripe to get paid'}
        </Text>
        <Text style={styles.connectBannerSub}>
          {connectStatus.connected
            ? 'Buyers can\'t checkout until Stripe verifies your account. Tap to complete setup.'
            : 'Your store is live but buyers can\'t pay yet. Tap to connect Stripe.'}
        </Text>
      </View>
      <View style={styles.connectBannerArrow}>
        {loading
          ? <Text style={styles.opening}>Opening…</Text>
          : <>
              <Text style={styles.connectBannerFix}>Fix Now</Text>
              <Feather name="chevron-right" size={14} color={RED} />
            </>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  connectBanner: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderRadius: RADIUS.md,
    padding: SP.md,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
  },
  connectBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(239,68,68,0.12)',
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
    color: '#F87171',
    marginBottom: 3,
  },
  connectBannerSub: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: 'rgba(248,113,113,0.75)',
    lineHeight: 16,
  },
  connectBannerArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
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
/**
 * One-time offer sheet — shown after a seller dismisses the exit drawer,
 * ONLY when `isOneTimeOfferAvailable` (lib/paywallRetentionConfig.ts) is
 * true. Off by default: no real discounted product exists yet, so this
 * component is currently unreachable in production. The discount is always
 * computed from the real plan price — never a separate hard-coded number.
 *
 * Same plain `Modal` + `Animated.timing` sheet pattern as
 * SellerPaywallExitDrawer (see that file's comment for why).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { SellerPlanDefinition } from '@/lib/sellerPlans';
import { SellerPaywallCTA } from './SellerPaywallCTA';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import type { ButtonProps } from '@/components/ui/Button';

export interface SellerPaywallOneTimeOfferProps {
  visible: boolean;
  onClose: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
  plan: SellerPlanDefinition;
  discountPercent: number;
  onAccept: ButtonProps['onPress'];
  loading?: boolean;
  disabled?: boolean;
}

const OPEN_MS = 260;
const CLOSE_MS = 200;
const OFFSCREEN_Y = 700;

export function SellerPaywallOneTimeOffer({
  visible, onClose, theme, plan, discountPercent, onAccept, loading, disabled,
}: SellerPaywallOneTimeOfferProps) {
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(visible);
  const translateY = useRef(new Animated.Value(OFFSCREEN_Y)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const nativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      Animated.timing(backdropOpacity, { toValue: 1, duration: OPEN_MS, useNativeDriver: nativeDriver }).start();
      Animated.timing(translateY, { toValue: 0, duration: OPEN_MS, useNativeDriver: nativeDriver }).start();
      return;
    }
    Animated.timing(backdropOpacity, { toValue: 0, duration: CLOSE_MS, useNativeDriver: nativeDriver }).start();
    Animated.timing(translateY, { toValue: OFFSCREEN_Y, duration: CLOSE_MS, useNativeDriver: nativeDriver }).start(({ finished }) => {
      if (finished) setModalVisible(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const discountedCents = Math.round(plan.priceCents * (1 - discountPercent / 100));
  const discountedLabel = `$${(discountedCents / 100).toFixed(2)}`;

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose} testID="seller-paywall-one-time-offer">
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          >
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.card, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, SP.md), transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.muted }]} />
          </View>

          <View style={styles.wrap}>
            <Text style={[styles.eyebrow, { color: theme.muted }]}>A ONE-TIME OFFER FOR NEW BRANDS</Text>
            <Text style={[styles.title, { color: theme.text }]}>
              {discountPercent}% off {plan.name} for your first month
            </Text>
            <Text style={[styles.priceRow, { color: theme.text }]}>
              {discountedLabel}
              <Text style={[styles.strike, { color: theme.muted }]}>  {plan.priceLabel}</Text>
            </Text>

            <View style={{ marginTop: SP.lg }}>
              <SellerPaywallCTA
                theme={theme}
                label={`Claim ${discountPercent}% off`}
                onPress={onAccept}
                loading={loading}
                disabled={disabled}
                testID="seller-paywall-one-time-offer-cta"
                subtext="One-time offer, applied to your first month only."
              />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, maxHeight: '88%',
  },
  handleWrap: { alignItems: 'center', paddingTop: SP.xs, paddingBottom: 2 },
  handle: { width: 36, height: 4, borderRadius: RADIUS.pill, opacity: 0.3 },
  wrap: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.lg, alignItems: 'center' },
  eyebrow: { fontSize: FS.xs, fontFamily: FONT.semibold },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center', marginTop: 8 },
  priceRow: { fontSize: 28, fontFamily: FONT.semibold, marginTop: 12 },
  strike: { fontSize: FS.sm, fontFamily: FONT.regular, textDecorationLine: 'line-through' },
});

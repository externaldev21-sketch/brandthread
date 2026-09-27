/**
 * Exit drawer — shown when a seller tries to leave the paywall without
 * starting a trial. Keeps the recommended plan selected, reframes its real
 * price per week/day, shows the other plans compactly, and repeats the same
 * trial CTA. No discount here — that only ever lives in
 * SellerPaywallOneTimeOffer, gated separately.
 *
 * Uses a plain RN `Modal` + `Animated.timing` slide-up (no Reanimated/
 * gesture-handler) — this screen is reached via direct navigation
 * (settings, or deep link) rather than a child interaction deep in an
 * already-mounted screen, so it intentionally avoids the shared
 * `components/ui/BottomSheet` primitive's worklet/gesture setup here.
 * Same "no bounce" rule: `Animated.timing` only, never a spring.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { weeklyEquivalentFor, dailyEquivalentFor } from '@/lib/sellerPlansDisplay';
import type { SellerPlanDefinition } from '@/lib/sellerPlans';
import { SellerPlanSelector, type PlanPricing } from './SellerPlanSelector';
import { SellerPaywallCTA } from './SellerPaywallCTA';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import type { ButtonProps } from '@/components/ui/Button';

export interface SellerPaywallExitDrawerProps {
  visible: boolean;
  onClose: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
  plans: SellerPlanDefinition[];
  recommendedId: string | null;
  currentPlanId: string | null;
  isOnboarding: boolean;
  selectedId: string | null;
  onSelect: (planId: SellerPlanDefinition['id']) => void;
  getPricing: (plan: SellerPlanDefinition) => PlanPricing;
  selectedPlan: SellerPlanDefinition;
  hasRealTrialOffer: boolean;
  onStartTrial: ButtonProps['onPress'];
  loading?: boolean;
  ctaDisabled?: boolean;
}

const OPEN_MS = 260;
const CLOSE_MS = 200;
const OFFSCREEN_Y = 700;

export function SellerPaywallExitDrawer({
  visible, onClose, theme, plans, recommendedId, currentPlanId, isOnboarding,
  selectedId, onSelect, getPricing, selectedPlan, hasRealTrialOffer, onStartTrial, loading, ctaDisabled,
}: SellerPaywallExitDrawerProps) {
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

  const weekly = weeklyEquivalentFor(selectedPlan);
  const daily = dailyEquivalentFor(selectedPlan);
  const pricing = getPricing(selectedPlan);

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose} testID="seller-paywall-exit-drawer">
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
            <Text style={[styles.title, { color: theme.text }]}>Not ready to commit?</Text>
            {!pricing.loading && !pricing.failed && (
              <Text style={[styles.reframe, { color: theme.muted }]}>
                {`${pricing.priceLabel ?? selectedPlan.priceLabel}${pricing.period}, that's about ${weekly}${daily ? ` (${daily})` : ''}`}
              </Text>
            )}

            <View style={{ marginTop: SP.md }}>
              <SellerPlanSelector
                theme={theme}
                plans={plans}
                recommendedId={recommendedId}
                currentPlanId={currentPlanId}
                isOnboarding={isOnboarding}
                selectedId={selectedId}
                onSelect={onSelect}
                getPricing={getPricing}
                compact
              />
            </View>

            <View style={{ marginTop: SP.lg }}>
              <SellerPaywallCTA
                theme={theme}
                label={hasRealTrialOffer ? 'Start my 5-day free trial' : `Choose ${selectedPlan.name}`}
                onPress={onStartTrial}
                icon={hasRealTrialOffer ? 'chevron-right' : undefined}
                loading={loading}
                disabled={ctaDisabled}
                testID="seller-paywall-exit-drawer-cta"
                subtext="No commitment. Cancel anytime."
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
  wrap: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.lg },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, textAlign: 'center' },
  reframe: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: 6 },
});

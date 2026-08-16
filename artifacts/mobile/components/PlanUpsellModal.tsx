/**
 * PlanUpsellModal — shown when a Starter seller taps a Growth-only feature.
 *
 * Props:
 *   visible      — controls modal visibility
 *   onClose      — called when the user dismisses without upgrading
 *   onUpgrade    — called when the user taps the upgrade CTA
 *   featureName  — the locked feature, e.g. "AI Design Studio"
 *   requiredPlan — the minimum plan needed (default: 'growth')
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, SUCCESS, FONT, FS, SP, RADIUS,
} from '@/lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  featureName: string;
  requiredPlan?: 'growth' | 'pro';
}

// Features highlighted per required plan
const GROWTH_FEATURES = [
  'AI Design Studio',
  'AI Photoshoot & background removal',
  'Manufacturer Hub access',
  'Unlimited products',
  'Custom storefront + domain',
];

const PRO_FEATURES = [
  'Everything in Growth',
  'Advanced analytics',
  'Priority support',
  'Dedicated account manager',
  'Custom integrations',
];

export default function PlanUpsellModal({
  visible,
  onClose,
  onUpgrade,
  featureName,
  requiredPlan = 'growth',
}: Props) {
  const planLabel = requiredPlan === 'pro' ? 'Pro' : 'Growth';
  const planPrice = requiredPlan === 'pro' ? '$79' : '$29';
  const features  = requiredPlan === 'pro' ? PRO_FEATURES : GROWTH_FEATURES;

  function handleUpgrade() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onUpgrade();
  }

  function handleClose() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={handleClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          {/* Gradient header */}
          <LinearGradient
            colors={['#3B1FA3', '#6D28D9']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.header}
          >
            {/* Close button */}
            <TouchableOpacity style={s.closeBtn} onPress={handleClose} hitSlop={8}>
              <Feather name="x" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>

            {/* Lock icon */}
            <View style={s.lockCircle}>
              <Feather name="lock" size={24} color={PURPLE_LIGHT} />
            </View>

            <Text style={s.headerTitle}>Upgrade to {planLabel}</Text>
            <Text style={s.headerSubtitle}>
              <Text style={s.featureName}>{featureName}</Text>
              {' '}is available on the {planLabel} plan ({planPrice}/mo).
            </Text>
          </LinearGradient>

          {/* Feature list */}
          <View style={s.body}>
            <Text style={s.bodyLabel}>What you'll unlock</Text>
            {features.map((f) => (
              <View key={f} style={s.featureRow}>
                <View style={s.checkCircle}>
                  <Feather name="check" size={12} color={SUCCESS} />
                </View>
                <Text style={s.featureText}>{f}</Text>
              </View>
            ))}

            {/* CTA */}
            <TouchableOpacity style={s.upgradeBtn} onPress={handleUpgrade} activeOpacity={0.85}>
              <Feather name="zap" size={16} color="#FFF" />
              <Text style={s.upgradeBtnText}>Upgrade to {planLabel}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.laterBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={s.laterText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  header: {
    paddingTop: SP.xl,
    paddingBottom: SP.xl,
    paddingHorizontal: SP.xl,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: SP.md,
    right: SP.md,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(139,92,246,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.md,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: FS.xl,
    fontFamily: FONT.semibold,
    marginBottom: SP.xs,
    textAlign: 'center',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureName: {
    fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.9)',
  },
  body: {
    padding: SP.xl,
  },
  bodyLabel: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SP.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: `${SUCCESS}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    flex: 1,
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    backgroundColor: PURPLE,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md,
    marginTop: SP.lg,
  },
  upgradeBtnText: {
    color: '#FFFFFF',
    fontSize: FS.md,
    fontFamily: FONT.semibold,
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: SP.md,
  },
  laterText: {
    color: SUBTLE,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
  },
});

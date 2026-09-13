/**
 * Seller Identity Verification
 *
 * Walks the seller through Stripe Identity's hosted document-check flow.
 * Status lifecycle:  unverified → pending → verified | failed
 * Stripe sends a webhook that flips the status; the screen polls on re-focus.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { BG, CARD, BORDER, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, RED, RED_DIM, ORANGE, ORANGE_DIM, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadHeader, PrimaryButton, SecondaryButton, GradientCard, BrandedLoadingState } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeTask } from '@/lib/setupStore';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed';

interface VerificationState {
  verified: boolean;
  verificationStatus: VerificationStatus;
  sessionId?: string | null;
}

// ─── Status display config ────────────────────────────────────────────────────

const STATUS_CONFIG: Record<VerificationStatus, {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  bg: string;
  title: string;
  body: string;
}> = {
  unverified: {
    icon: 'shield',
    color: MUTED,
    bg: CARD,
    title: 'Not yet verified',
    body: 'Verify your identity to earn the verified seller badge and build buyer trust.',
  },
  pending: {
    icon: 'clock',
    color: ORANGE,
    bg: ORANGE_DIM,
    title: 'Verification in progress',
    body: "Stripe is reviewing your documents. This usually takes a few minutes. We'll notify you when it's done.",
  },
  verified: {
    icon: 'check-circle',
    color: SUCCESS,
    bg: SUCCESS_DIM,
    title: "You're verified!",
    body: 'Your identity has been confirmed. Your verified badge is now live on your storefront and profile.',
  },
  failed: {
    icon: 'alert-circle',
    color: RED,
    bg: RED_DIM,
    title: 'Verification failed',
    body: "We couldn't confirm your identity with the documents provided. You can start the process again with different documents.",
  },
};

// ─── Benefits list ────────────────────────────────────────────────────────────

const BENEFITS = [
  { icon: 'award' as const,      text: 'Verified badge on your storefront and all product pages' },
  { icon: 'trending-up' as const, text: 'Higher placement in buyer search results' },
  { icon: 'shield' as const,     text: 'Builds buyer trust and increases conversion' },
  { icon: 'check-circle' as const, text: 'Required for high-volume payouts' },
];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SellerVerificationScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM } = theme;
  const router = useRouter();
  const params = useLocalSearchParams();
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [state, setState] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function leaveSetupDestination() {
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  // Load current verification status
  const loadStatus = useCallback(async () => {
    try {
      const data = await (api as any).seller.verification.status();
      setState(data);
      if (data?.verificationStatus === 'verified') {
        await completeTask('verify_account');
      }
    } catch (err) {
      console.warn('verification status error:', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Re-check status when the seller returns to this screen (e.g. after browser)
  useFocusEffect(useCallback(() => {
    if (!loading) loadStatus();
  }, [loading, loadStatus]));

  async function handleStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStarting(true);
    try {
      const result = await (api as any).seller.verification.start();
      if (!result?.url) {
        Alert.alert('Error', 'Could not start verification. Please try again.');
        return;
      }

      // Open Stripe Identity hosted flow in device browser
      const canOpen = await Linking.canOpenURL(result.url);
      if (!canOpen) {
        Alert.alert(
          'Cannot open browser',
          'Please open this link manually:\n\n' + result.url,
          [{ text: 'OK' }],
        );
        return;
      }

      await Linking.openURL(result.url);

      // After the URL opens, update local state optimistically
      setState(prev => prev ? { ...prev, verificationStatus: 'pending' } : prev);
    } catch (err: any) {
      const code = err?.response?.data?.error ?? err?.message ?? '';
      if (code === 'ALREADY_VERIFIED') {
        Alert.alert('Already verified', 'Your account is already verified.');
        loadStatus();
      } else if (code === 'IDENTITY_NOT_ENABLED') {
        Alert.alert(
          'Stripe Identity not enabled',
          'Your Stripe account needs Stripe Identity enabled. Log in to your Stripe Dashboard → More → Identity to activate it.',
        );
      } else {
        Alert.alert('Error', 'Could not start verification. Please try again later.');
      }
    } finally {
      setStarting(false);
    }
  }

  async function handleRetry() {
    Alert.alert(
      'Start over?',
      'This will cancel your current verification attempt and let you try again with different documents.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start over',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await (api as any).seller.verification.cancel();
              setState(prev => prev ? { ...prev, verificationStatus: 'unverified', sessionId: null } : prev);
            } catch {
              Alert.alert('Error', 'Could not reset verification. Please try again.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <BrandthreadHeader title="Identity Verification" onBack={leaveSetupDestination} />
        <BrandedLoadingState message="Checking verification status…" />
      </View>
    );
  }

  const status = state?.verificationStatus ?? 'unverified';
  const cfg = STATUS_CONFIG[status];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <BrandthreadHeader title="Identity Verification" onBack={leaveSetupDestination} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Status card ── */}
        <View style={[s.statusCard, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
          <View style={[s.statusIconWrap, { backgroundColor: cfg.color + '20' }]}>
            <Feather name={cfg.icon} size={ICON.lg} color={cfg.color} />
          </View>
          <Text style={[s.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
          <Text style={s.statusBody}>{cfg.body}</Text>
        </View>

        {/* ── Verified badge preview ── */}
        {status === 'verified' && (
          <GradientCard style={s.verifiedCard}>
            <View style={s.verifiedRow}>
              <Feather name="check-circle" size={ICON.md} color={SUCCESS} />
              <Text style={s.verifiedLabel}>Verified Seller Badge</Text>
            </View>
            <Text style={s.verifiedSub}>
              Visible on your storefront, product pages, and buyer search results.
            </Text>
          </GradientCard>
        )}

        {/* ── Benefits (shown when not yet verified) ── */}
        {(status === 'unverified' || status === 'failed') && (
          <View style={s.benefitsSection}>
            <Text style={s.sectionTitle}>Why get verified?</Text>
            {BENEFITS.map((b, i) => (
              <View key={i} style={s.benefitRow}>
                <View style={s.benefitIconWrap}>
                  <Feather name={b.icon} size={ICON.sm} color={PURPLE} />
                </View>
                <Text style={s.benefitText}>{b.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── How it works ── */}
        {status === 'unverified' && (
          <View style={s.stepsSection}>
            <Text style={s.sectionTitle}>How it works</Text>
            {[
              { n: '1', text: 'Tap "Start verification" below' },
              { n: '2', text: "Take a photo of your government-issued ID (passport, driver's licence, or national ID card)" },
              { n: '3', text: 'Take a quick selfie to match your face to the document' },
              { n: '4', text: 'Stripe reviews the documents — typically takes a few minutes' },
            ].map(step => (
              <View key={step.n} style={s.stepRow}>
                <View style={s.stepNum}>
                  <Text style={s.stepNumText}>{step.n}</Text>
                </View>
                <Text style={s.stepText}>{step.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Privacy note ── */}
        {(status === 'unverified' || status === 'failed') && (
          <View style={s.privacyNote}>
            <Feather name="lock" size={14} color={MUTED} style={{ marginTop: 1 }} />
            <Text style={s.privacyText}>
              Verification is processed securely by Stripe. Brandthread does not store your ID documents. Stripe's{' '}
              <Text
                style={s.privacyLink}
                onPress={() => Linking.openURL('https://stripe.com/privacy')}
              >
                Privacy Policy
              </Text>{' '}
              applies.
            </Text>
          </View>
        )}

        {/* ── CTA buttons ── */}
        <View style={s.ctaSection}>
          {status === 'unverified' && (
            <PrimaryButton
              label={starting ? 'Opening Stripe…' : 'Start verification'}
              onPress={handleStart}
              loading={starting}
              disabled={starting}
            />
          )}

          {status === 'pending' && (
            <>
              <SecondaryButton
                label={loading ? 'Checking…' : 'Check status'}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadStatus(); }}
              />
              <Text style={s.pendingHint}>
                Stripe will notify us automatically when the review is complete.
                You can leave this screen — we'll send you a push notification.
              </Text>
            </>
          )}

          {status === 'failed' && (
            <>
              <PrimaryButton
                label={starting ? 'Opening Stripe…' : 'Try again'}
                onPress={handleRetry}
                loading={cancelling}
                disabled={starting || cancelling}
              />
              <Text style={s.pendingHint}>
                You can retry with different documents or contact support if the issue persists.
              </Text>
            </>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: SP.lg,
    gap: SP.lg,
  },

  // Status card
  statusCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SP.lg,
    alignItems: 'center',
    gap: SP.sm,
  },
  statusIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  statusTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    textAlign: 'center',
  },
  statusBody: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Verified badge card
  verifiedCard: {
    gap: SP.xs,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  verifiedLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },
  verifiedSub: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    lineHeight: 20,
  },

  // Benefits
  benefitsSection: { gap: SP.sm },
  sectionTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SP.xs,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    paddingVertical: SP.xs,
  },
  benefitIconWrap: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    lineHeight: 20,
  },

  // Steps
  stepsSection: { gap: SP.sm },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    paddingVertical: SP.xs,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: PURPLE_LIGHT,
  },
  stepText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    lineHeight: 20,
  },

  // Privacy note
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.xs,
    paddingHorizontal: SP.xs,
  },
  privacyText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    lineHeight: 18,
  },
  privacyLink: {
    color: PURPLE_LIGHT,
    textDecorationLine: 'underline',
  },

  // CTA
  ctaSection: { gap: SP.md },
  pendingHint: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 18,
  },
});

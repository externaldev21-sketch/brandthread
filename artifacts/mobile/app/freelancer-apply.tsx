/**
 * Freelancer application — multi-step form.
 * Step 1: service type + skill tags · Step 2: rate + bio · Step 3: portfolio + submit.
 * Also used to edit an existing profile (prefills from /api/freelancers/me).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { FREELANCER_SERVICE_TYPES, apiErrorMessage } from '@/lib/freelancer';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, RED,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { formatCents, parseDecimalToCents } from '@/lib/money';

const STEPS = ['Service', 'Rate & Bio', 'Portfolio'];

export default function FreelancerApplyScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [serviceType, setServiceType] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [rateText, setRateText] = useState('');
  const [bio, setBio] = useState('');
  const [urls, setUrls] = useState<string[]>(['', '', '', '']);

  // Prefill when editing an existing profile
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { freelancer } = await api.freelancers.me();
        if (mounted && freelancer) {
          setIsEdit(true);
          setServiceType(freelancer.serviceType);
          setTagsText((freelancer.skillTags ?? []).join(', '));
          setRateText(formatCents(freelancer.hourlyRateCents).slice(1));
          setBio(freelancer.bio ?? '');
          const u = [...(freelancer.portfolioUrls ?? [])];
          while (u.length < 4) u.push('');
          setUrls(u.slice(0, 4));
        }
      } catch {
        // not signed in or no profile — fresh form
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [api]);

  const rateCents = rateText.trim() ? parseDecimalToCents(rateText) : 0;
  const stepValid =
    step === 0 ? serviceType !== null
    : step === 1 ? rateCents !== null && rateCents >= 100
    : true;

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < 2) setStep(step + 1);
  };

  const promptConnect = useCallback(
    (freelancerId: string) => {
      Alert.alert(
        isEdit ? 'Profile updated' : 'Welcome to the community!',
        'Connect your bank account so you can get paid for jobs.',
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => router.replace(`/freelancer-profile?id=${freelancerId}` as any),
          },
          {
            text: 'Connect now',
            onPress: async () => {
              try {
                const { url } = await api.freelancerConnect.onboard();
                await WebBrowser.openBrowserAsync(url);
              } catch (e) {
                Alert.alert('Could not start onboarding', apiErrorMessage(e));
              }
              router.replace(`/freelancer-profile?id=${freelancerId}` as any);
            },
          },
        ],
      );
    },
    [api, isEdit, router],
  );

  const submit = async () => {
    if (!serviceType || submitting) return;
    setSubmitting(true);
    try {
      const skillTags = tagsText.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const portfolioUrls = urls.map((u) => u.trim()).filter(Boolean);
      const { freelancer } = await api.freelancers.apply({
        serviceType,
        hourlyRateCents: rateCents ?? 0,
        bio: bio.trim(),
        skillTags,
        portfolioUrls,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!freelancer.hasConnectedAccount) {
        promptConnect(freelancer.id);
      } else {
        router.replace(`/freelancer-profile?id=${freelancer.id}` as any);
      }
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not save profile', apiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={isEdit ? 'Edit Freelancer Profile' : 'Become a Freelancer'}
        subtitle={`Step ${step + 1} of 3 — ${STEPS[step]}`}
      />
      {/* Step dots */}
      <View style={styles.dotsRow}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.stepDot, i <= step && { backgroundColor: colors.primary }]} />
        ))}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SP.md + 4, paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 && (
            <>
              <Text style={styles.label}>What do you do best?</Text>
              <View style={styles.typeGrid}>
                {FREELANCER_SERVICE_TYPES.map((t) => {
                  const active = serviceType === t.value;
                  return (
                    <TouchableOpacity
                      key={t.value}
                      style={[styles.typeCard, active && { backgroundColor: colors.accent, borderColor: colors.primary }]}
                      activeOpacity={0.8}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setServiceType(t.value);
                      }}
                    >
                      <Feather name={t.icon} size={18} color={active ? colors.primary : MUTED} />
                      <Text style={[styles.typeLabel, active && { color: FG }]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.label, { marginTop: SP.lg }]}>Skill tags (optional)</Text>
              <Text style={styles.hint}>Comma-separated, e.g. logos, packaging, lookbooks</Text>
              <TextInput
                style={styles.input}
                value={tagsText}
                onChangeText={setTagsText}
                placeholder="logos, packaging, lookbooks"
                placeholderTextColor={SUBTLE}
              />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.label}>Hourly rate (USD)</Text>
              <View style={styles.rateRow}>
                <Text style={styles.ratePrefix}>$</Text>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={rateText}
                  onChangeText={(v) => setRateText(v.replace(/[^0-9.]/g, ''))}
                  placeholder="65"
                  placeholderTextColor={SUBTLE}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.rateSuffix}>/hr</Text>
              </View>
              {rateText !== '' && (rateCents === null || rateCents < 100) && (
                <Text style={styles.errorText}>Minimum rate is $1/hr</Text>
              )}

              <Text style={[styles.label, { marginTop: SP.lg }]}>Bio</Text>
              <Text style={styles.hint}>Tell brand founders what you can do for them</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={bio}
                onChangeText={setBio}
                placeholder="I've designed identities for 40+ streetwear brands…"
                placeholderTextColor={SUBTLE}
                multiline
                maxLength={2000}
              />
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.label}>Portfolio links (up to 4, optional)</Text>
              <Text style={styles.hint}>Behance, Dribbble, Instagram, your site…</Text>
              {urls.map((u, i) => (
                <TextInput
                  key={i}
                  style={styles.input}
                  value={u}
                  onChangeText={(v) => {
                    const nextUrls = [...urls];
                    nextUrls[i] = v;
                    setUrls(nextUrls);
                  }}
                  placeholder={`https://…`}
                  placeholderTextColor={SUBTLE}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              ))}

              <View style={styles.reviewCard}>
                <Text style={styles.reviewTitle}>Review</Text>
                <Text style={styles.reviewLine}>
                  {FREELANCER_SERVICE_TYPES.find((t) => t.value === serviceType)?.label ?? '—'} · $
                  {rateText || '0'}/hr
                </Text>
                {bio.trim() !== '' && (
                  <Text style={styles.reviewBio} numberOfLines={3}>{bio.trim()}</Text>
                )}
                <Text style={styles.reviewFee}>
                  Brandthread takes a 5% platform fee on each paid job — you keep 95%.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        {/* Footer buttons */}
        <View style={styles.footer}>
          {step > 0 && (
            <TouchableOpacity
              style={styles.backBtn}
              activeOpacity={0.8}
              onPress={() => setStep(step - 1)}
            >
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={0.9}
            disabled={!stepValid || submitting}
            onPress={step === 2 ? submit : next}
          >
            <LinearGradient
              colors={[colors.primary, colors.accentForeground] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.nextBtn, (!stepValid || submitting) && { opacity: 0.4 }]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.nextBtnText, { color: colors.primaryForeground }]}>
                  {step === 2 ? (isEdit ? 'Save Profile' : 'Submit Application') : 'Continue'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  dotsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SP.md + 4, paddingTop: SP.md },
  stepDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: BORDER },
  label: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.xs },
  hint: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginBottom: SP.sm + 2 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm + 2, marginTop: SP.sm },
  typeCard: {
    width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.sm, paddingHorizontal: SP.sm + 4, paddingVertical: SP.md - 2,
  },
  typeLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, flexShrink: 1 },
  input: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm,
    color: FG, fontSize: FS.sm, fontFamily: FONT.regular,
    paddingHorizontal: SP.md - 2, paddingVertical: SP.sm + 4, marginBottom: SP.sm + 2,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  ratePrefix: { color: FG, fontSize: FS.lg, fontFamily: FONT.bold },
  rateSuffix: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  errorText: { color: RED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.xs },
  reviewCard: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md,
    padding: SP.md, marginTop: SP.md,
  },
  reviewTitle: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 1, textTransform: 'uppercase' },
  reviewLine: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: SP.xs },
  reviewBio: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.xs },
  reviewFee: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.sm },
  footer: {
    flexDirection: 'row', gap: SP.sm + 2, padding: SP.md + 4, paddingBottom: SP.lg + 8,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  backBtn: {
    paddingHorizontal: SP.lg, justifyContent: 'center',
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm,
  },
  backBtnText: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
  nextBtn: { borderRadius: RADIUS.sm, alignItems: 'center', paddingVertical: SP.md - 2 },
  nextBtnText: { fontSize: FS.sm, fontFamily: FONT.bold },
});

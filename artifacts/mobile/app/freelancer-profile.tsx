/**
 * Freelancer profile — full profile view + hire flow.
 * Others see a "Hire" button → job form → Stripe Checkout (escrow).
 * The owner sees Edit / Connect Bank Account / My Gigs / Deactivate.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, Modal, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi, type Freelancer } from '@/lib/api';
import { serviceLabel, serviceIcon, formatHourlyRate, formatPrice, ratingLabel, apiErrorMessage, apiErrorCode } from '@/lib/freelancer';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { centsAtBasisPoints, parseDecimalToCents } from '@/lib/money';

const PLATFORM_FEE_BASIS_POINTS = 500; // display only — server computes the real fee

export default function FreelancerProfileScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
  const [me, setMe] = useState<Freelancer | null>(null);
  const [connect, setConnect] = useState<{ connected: boolean; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Hire modal state
  const [hireVisible, setHireVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [hiring, setHiring] = useState(false);

  const isOwn = !!freelancer && !!me && freelancer.id === me.id;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const [{ freelancer: f }, meRes] = await Promise.all([
        api.freelancers.get(id),
        api.freelancers.me().catch(() => ({ freelancer: null as Freelancer | null })),
      ]);
      setFreelancer(f);
      setMe(meRes.freelancer);
      if (meRes.freelancer && meRes.freelancer.id === f.id) {
        const status = await api.freelancerConnect.status().catch(() => null);
        setConnect(status ? { connected: status.connected, status: status.status } : null);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startConnectOnboarding = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { url } = await api.freelancerConnect.onboard();
      await WebBrowser.openBrowserAsync(url);
      await load(); // refresh status after the browser closes
    } catch (e) {
      Alert.alert('Could not start onboarding', apiErrorMessage(e));
    }
  };

  const deactivate = () => {
    Alert.alert(
      'Deactivate listing?',
      'Your profile will be hidden from the community. Existing jobs are unaffected, and you can reapply anytime.',
      [
        { text: 'Keep listing', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.freelancers.deactivate();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            } catch (e) {
              Alert.alert('Failed', apiErrorMessage(e));
            }
          },
        },
      ],
    );
  };

  const parsedPriceCents = priceText.trim() ? parseDecimalToCents(priceText) : 0;
  const priceCents = parsedPriceCents ?? 0;
  const feeCents = centsAtBasisPoints(priceCents, PLATFORM_FEE_BASIS_POINTS);
  const netCents = priceCents - feeCents;
  const hireValid = title.trim().length > 0 && parsedPriceCents !== null && priceCents >= 100;

  const submitHire = async () => {
    if (!freelancer || !hireValid || hiring) return;
    setHiring(true);
    try {
      const { job, checkoutUrl } = await api.freelancerJobs.create({
        freelancerId: freelancer.id,
        title: title.trim(),
        description: description.trim(),
        agreedPriceCents: priceCents,
      });
      setHireVisible(false);

      if (checkoutUrl) {
        const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, 'mobile://checkout/return');
        // Webhooks can lag in dev — confirm payment status directly
        try { await api.freelancerJobs.syncPayment(job.id); } catch {}
        if (result.type === 'success') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Payment sent',
            `${freelancer.name} has been notified. Funds are held by Brandthread until the job is completed.`,
          );
        } else {
          Alert.alert(
            'Checkout not completed',
            'Your job was created but payment wasn\'t finished. Open it in My Jobs to check the payment status.',
          );
        }
      }
      setTitle(''); setDescription(''); setPriceText('');
      router.push('/freelancer-jobs' as any);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = apiErrorCode(e);
      Alert.alert(
        code === 'FREELANCER_NOT_PAYABLE' ? 'Not available yet' : 'Could not create job',
        apiErrorMessage(e),
      );
    } finally {
      setHiring(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !freelancer) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Freelancer" />
        <View style={styles.center}>
          <Feather name="alert-circle" size={24} color={theme.subtle} />
          <Text style={styles.errorText}>{error ?? 'Freelancer not found'}</Text>
        </View>
      </View>
    );
  }

  const rating = ratingLabel(freelancer.avgRatingTenths);
  const connectReady = connect?.status === 'active';

  return (
    <View style={styles.container}>
      <ScreenHeader title={isOwn ? 'Your Profile' : 'Freelancer'} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SP.md + 4, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity card */}
        <View style={styles.heroCard}>
          {freelancer.avatarUrl ? (
            <Image source={{ uri: freelancer.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{(freelancer.name || 'F')[0].toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name}>{freelancer.name}</Text>
          {freelancer.username && <Text style={styles.username}>@{freelancer.username}</Text>}
          <View style={styles.serviceRow}>
            <Feather name={serviceIcon(freelancer.serviceType)} size={13} color={theme.secondary} />
            <Text style={[styles.serviceText, { color: theme.secondary }]}>{serviceLabel(freelancer.serviceType)}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatHourlyRate(freelancer.hourlyRateCents)}</Text>
              <Text style={styles.statLabel}>Rate</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {rating && <Feather name="star" size={13} color={theme.warning} />}
                <Text style={styles.statValue}>{rating ?? 'New'}</Text>
              </View>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{freelancer.totalJobsCompleted}</Text>
              <Text style={styles.statLabel}>Jobs done</Text>
            </View>
          </View>

          {freelancer.payoutsReady ? (
            <View style={[styles.payBadge, { backgroundColor: theme.success + '26' }]}>
              <Feather name="check-circle" size={12} color={theme.success} />
              <Text style={[styles.payBadgeText, { color: theme.success }]}>Payouts ready</Text>
            </View>
          ) : !freelancer.hasConnectedAccount ? (
            <View style={[styles.payBadge, { backgroundColor: theme.warning + '26' }]}>
              <Feather name="clock" size={12} color={theme.warning} />
              <Text style={[styles.payBadgeText, { color: theme.warning }]}>
                {isOwn ? 'Payout setup incomplete' : 'Hasn\'t set up payouts yet'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Bio */}
        {!!freelancer.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{freelancer.bio}</Text>
          </View>
        )}

        {/* Skill tags */}
        {freelancer.skillTags.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.tagsRow}>
              {freelancer.skillTags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: theme.accentDim }]}>
                  <Text style={[styles.tagText, { color: theme.accent }]}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Portfolio */}
        {freelancer.portfolioUrls.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Portfolio</Text>
            {freelancer.portfolioUrls.map((u) => (
              <TouchableOpacity
                key={u}
                style={styles.linkRow}
                activeOpacity={0.7}
                onPress={() => Linking.openURL(u).catch(() => {})}
              >
                <Feather name="external-link" size={14} color={theme.secondary} />
                <Text style={styles.linkText} numberOfLines={1}>{u.replace(/^https?:\/\//, '')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Owner actions */}
        {isOwn && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Manage</Text>

            {!connectReady && (
              <TouchableOpacity activeOpacity={0.9} onPress={startConnectOnboarding}>
                <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.connectBtn}
                >
                  <Feather name="credit-card" size={16} color={theme.onAccent} />
                  <Text style={styles.connectBtnText}>
                    {freelancer.hasConnectedAccount ? 'Finish Payout Setup' : 'Connect Bank Account'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.manageRow}
              activeOpacity={0.7}
              onPress={() => router.push('/freelancer-apply' as any)}
            >
              <Feather name="edit-3" size={16} color={colors.primary} />
              <Text style={styles.manageText}>Edit Profile</Text>
              <Feather name="chevron-right" size={16} color={theme.subtle} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.manageRow}
              activeOpacity={0.7}
              onPress={() => router.push('/freelancer-jobs' as any)}
            >
              <Feather name="briefcase" size={16} color={theme.secondary} />
              <Text style={styles.manageText}>My Gigs</Text>
              <Feather name="chevron-right" size={16} color={theme.subtle} />
            </TouchableOpacity>

            {freelancer.isActive && (
              <TouchableOpacity style={styles.manageRow} activeOpacity={0.7} onPress={deactivate}>
                <Feather name="eye-off" size={16} color={theme.error} />
                <Text style={[styles.manageText, { color: theme.error }]}>Deactivate Listing</Text>
                <Feather name="chevron-right" size={16} color={theme.subtle} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Hire footer (other users only) */}
      {!isOwn && (
        <View style={styles.footer}>
          {freelancer.hasConnectedAccount ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setHireVisible(true);
              }}
            >
              <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hireBtn}
              >
                <Feather name="zap" size={16} color={theme.onAccent} />
                <Text style={styles.hireBtnText}>Hire {freelancer.name.split(' ')[0]}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={styles.notPayableCard}>
              <Feather name="info" size={14} color={theme.warning} />
              <Text style={styles.notPayableText}>
                This freelancer hasn't set up payouts yet and can't accept paid jobs.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Hire modal */}
      <Modal visible={hireVisible} transparent animationType="slide" onRequestClose={() => setHireVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Hire {freelancer.name}</Text>
            <Text style={styles.modalSub}>
              Payment is held by Brandthread and released when the job is done.
            </Text>

            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Job title — e.g. Logo refresh for my drop"
              placeholderTextColor={theme.subtle}
              maxLength={200}
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the work, deliverables, and timeline…"
              placeholderTextColor={theme.subtle}
              multiline
              maxLength={5000}
            />
            <View style={styles.priceRow}>
              <Text style={styles.pricePrefix}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={priceText}
                onChangeText={(v) => setPriceText(v.replace(/[^0-9.]/g, ''))}
                placeholder="Agreed price"
                placeholderTextColor={theme.subtle}
                keyboardType="decimal-pad"
              />
            </View>

            {priceCents >= 100 && (
              <View style={styles.feeCard}>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>You pay</Text>
                  <Text style={styles.feeValue}>{formatPrice(priceCents)}</Text>
                </View>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Platform fee (5%)</Text>
                  <Text style={styles.feeValue}>-{formatPrice(feeCents)}</Text>
                </View>
                <View style={[styles.feeRow, { marginTop: 2 }]}>
                  <Text style={[styles.feeLabel, { color: theme.text }]}>Freelancer receives</Text>
                  <Text style={[styles.feeValue, { color: theme.success }]}>{formatPrice(netCents)}</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              activeOpacity={0.9}
              disabled={!hireValid || hiring}
              onPress={submitHire}
            >
              <LinearGradient
                  colors={[theme.accent, theme.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.hireBtn, (!hireValid || hiring) && { opacity: 0.4 }]}
              >
                {hiring ? (
                  <ActivityIndicator color={theme.onAccent} size="small" />
                ) : (
                  <>
                    <Feather name="lock" size={15} color={theme.onAccent} />
                    <Text style={styles.hireBtnText}>
                      {priceCents >= 100 ? `Pay ${formatPrice(priceCents)}` : 'Pay with Stripe'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              activeOpacity={0.7}
              onPress={() => setHireVisible(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  errorText: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: SP.xl },
  heroCard: {
    alignItems: 'center', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    borderRadius: RADIUS.lg, padding: SP.lg,
  },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  // Preserved identity accent: only the generated profile avatar remains brand purple.
  avatarFallback: { backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: theme.accent, fontSize: FS.xl, fontFamily: FONT.bold },
  name: { color: theme.text, fontSize: FS.lg, fontFamily: FONT.bold, marginTop: SP.sm + 2 },
  username: { color: theme.subtle, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: SP.xs + 2 },
  serviceText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: SP.md,
    borderTopWidth: 1, borderTopColor: theme.border, paddingTop: SP.md, alignSelf: 'stretch',
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: theme.border },
  statValue: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.bold },
  statLabel: { color: theme.subtle, fontSize: FS.xs, fontFamily: FONT.regular },
  payBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: SP.sm + 2, paddingVertical: 5, borderRadius: RADIUS.pill, marginTop: SP.md,
  },
  payBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  section: { marginTop: SP.lg },
  sectionTitle: {
    color: theme.subtle, fontSize: FS.xs, fontFamily: FONT.semibold,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: SP.sm,
  },
  bio: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 21 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  tag: {
    paddingHorizontal: SP.sm + 2, paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  tagText: { fontSize: FS.xs, fontFamily: FONT.medium },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.md - 2, paddingVertical: SP.sm + 4, marginBottom: SP.sm,
  },
  linkText: { color: theme.text, fontSize: FS.xs, fontFamily: FONT.medium, flex: 1 },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2,
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.md - 2, paddingVertical: SP.md - 4, marginBottom: SP.sm,
  },
  manageText: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.medium, flex: 1 },
  connectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    borderRadius: RADIUS.sm, paddingVertical: SP.md - 2, marginBottom: SP.sm,
  },
  connectBtnText: { color: theme.onAccent, fontSize: FS.sm, fontFamily: FONT.bold },
  footer: {
    padding: SP.md + 4, paddingBottom: SP.lg + 8, backgroundColor: theme.background,
    borderTopWidth: 1, borderTopColor: theme.border,
  },
  hireBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    borderRadius: RADIUS.sm, paddingVertical: SP.md - 2,
  },
  hireBtnText: { color: theme.onAccent, fontSize: FS.sm, fontFamily: FONT.bold },
  notPayableCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: theme.warning + '26', borderRadius: RADIUS.sm, padding: SP.md - 2,
  },
  notPayableText: { color: theme.warning, fontSize: FS.xs, fontFamily: FONT.medium, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: theme.background + 'CC', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SP.md + 4, paddingBottom: SP.xl,
    borderWidth: 1, borderColor: theme.border,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border,
    alignSelf: 'center', marginBottom: SP.md,
  },
  modalTitle: { color: theme.text, fontSize: FS.md, fontFamily: FONT.bold },
  modalSub: { color: theme.muted, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 4, marginBottom: SP.md },
  input: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    color: theme.text, fontSize: FS.sm, fontFamily: FONT.regular,
    paddingHorizontal: SP.md - 2, paddingVertical: SP.sm + 4, marginBottom: SP.sm + 2,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  pricePrefix: { color: theme.text, fontSize: FS.lg, fontFamily: FONT.bold },
  feeCard: {
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.sm,
    padding: SP.md - 2, marginTop: SP.sm + 2, marginBottom: SP.md, gap: 6,
  },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  feeLabel: { color: theme.muted, fontSize: FS.xs, fontFamily: FONT.regular },
  feeValue: { color: theme.text, fontSize: FS.xs, fontFamily: FONT.semibold },
  modalCancel: { alignItems: 'center', paddingVertical: SP.md },
  modalCancelText: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.medium },
});

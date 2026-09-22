/**
 * Freelancer jobs — tabbed view.
 * "Hiring": jobs I created as a hirer (status + cancel + payment check).
 * "My Gigs": jobs where I'm the freelancer (accept / start / complete).
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi, type FreelancerJob } from '@/lib/api';
import { serviceLabel, formatPrice, apiErrorMessage } from '@/lib/freelancer';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pending',     color: ORANGE,  bg: ORANGE_DIM },
  completed:   { label: 'Completed',   color: SUCCESS, bg: SUCCESS_DIM },
  cancelled:   { label: 'Cancelled',   color: RED,     bg: RED_DIM },
};

type JobsData = { isFreelancer: boolean; asHirer: FreelancerJob[]; asFreelancer: FreelancerJob[] };

export default function FreelancerJobsScreen() {
  const colors = useColors();
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<JobsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'hiring' | 'gigs'>('hiring');
  const [busyId, setBusyId] = useState<string | null>(null);
  const defaultedTab = useRef(false);
  const loadGeneration = useRef(0);
  const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
    ...STATUS_META,
    accepted: { label: 'Accepted', color: colors.primary, bg: colors.accent },
    in_progress: { label: 'In Progress', color: colors.primary, bg: colors.accent },
  };

  const load = useCallback(
    async (isRefresh = false) => {
      const generation = ++loadGeneration.current;
      if (!authLoaded) return;
      if (!userId) {
        setData(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      try {
        const res = await api.freelancerJobs.list();
        if (loadGeneration.current !== generation) return;
        setData(res);
        // Sensible default tab on first load: freelancers with gigs but no hires
        if (!defaultedTab.current) {
          defaultedTab.current = true;
          if (res.isFreelancer && res.asFreelancer.length > 0 && res.asHirer.length === 0) {
            setTab('gigs');
          }
        }
      } catch {
        // Keep existing data visible when a refresh cannot complete.
      } finally {
        if (loadGeneration.current === generation) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, authLoaded, userId],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const act = async (
    job: FreelancerJob,
    action: 'accept' | 'start' | 'complete' | 'cancel' | 'sync',
  ) => {
    setBusyId(job.id);
    try {
      if (action === 'accept') {
        await api.freelancerJobs.accept(job.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (action === 'start') {
        await api.freelancerJobs.start(job.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (action === 'complete') {
        const r = await api.freelancerJobs.complete(job.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Payout sent', `${formatPrice(r.payout.amountCents)} is on its way to your bank account.`);
      } else if (action === 'cancel') {
        await api.freelancerJobs.cancel(job.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (action === 'sync') {
        const r = await api.freelancerJobs.syncPayment(job.id);
        if (r.paymentStatus !== 'paid') {
          Alert.alert(
            'Not paid yet',
            "Stripe hasn't confirmed this payment. If you closed checkout early, cancel this job and create a new one.",
          );
        }
      }
      await load();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Action failed', apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmComplete = (job: FreelancerJob) => {
    Alert.alert(
      'Mark job complete?',
      `${formatPrice(job.freelancerPayoutCents)} will be transferred to your connected bank account.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Complete & get paid', onPress: () => act(job, 'complete') },
      ],
    );
  };

  const confirmCancel = (job: FreelancerJob, role: 'hirer' | 'freelancer') => {
    const refundNote =
      job.paymentStatus === 'paid'
        ? role === 'hirer'
          ? " You'll be refunded the full amount."
          : ' The hirer will be refunded the full amount.'
        : '';
    Alert.alert('Cancel this job?', `This can't be undone.${refundNote}`, [
      { text: 'Keep job', style: 'cancel' },
      { text: 'Cancel job', style: 'destructive', onPress: () => act(job, 'cancel') },
    ]);
  };

  const renderJob = (job: FreelancerJob, role: 'hirer' | 'freelancer') => {
    const meta = statusMeta[job.status] ?? statusMeta.pending;
    const busy = busyId === job.id;
    const counterpart = role === 'hirer' ? job.freelancerName : job.hirerName;
    const unpaid = job.paymentStatus === 'unpaid' && job.status === 'pending';

    return (
      <View key={job.id} style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <Text style={styles.jobSub} numberOfLines={1}>
          {role === 'hirer' ? 'Freelancer' : 'Hired by'}: {counterpart ?? '—'}
          {job.serviceType ? ` · ${serviceLabel(job.serviceType)}` : ''}
        </Text>
        {!!job.description && (
          <Text style={styles.jobDesc} numberOfLines={2}>{job.description}</Text>
        )}

        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(job.agreedPriceCents)}</Text>
          {unpaid && (
            <View style={styles.unpaidChip}>
              <Text style={styles.unpaidText}>Payment incomplete</Text>
            </View>
          )}
          {job.paymentStatus === 'refunded' && (
            <View style={[styles.unpaidChip, { backgroundColor: RED_DIM }]}>
              <Text style={[styles.unpaidText, { color: RED }]}>Refunded</Text>
            </View>
          )}
          {job.status === 'completed' && role === 'freelancer' && (
            <Text style={styles.payoutNote}>You received {formatPrice(job.freelancerPayoutCents)}</Text>
          )}
        </View>

        {/* Actions */}
        {busy ? (
          <View style={styles.actionsRow}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : (
          <View style={styles.actionsRow}>
            {role === 'freelancer' && job.status === 'pending' && job.paymentStatus === 'paid' && (
              <>
                <ActionBtn label="Accept" primary onPress={() => act(job, 'accept')} />
                <ActionBtn label="Decline" onPress={() => confirmCancel(job, role)} />
              </>
            )}
            {role === 'freelancer' && unpaid && (
              <Text style={styles.waitingText}>Waiting for the hirer's payment…</Text>
            )}
            {role === 'freelancer' && job.status === 'accepted' && (
              <>
                <ActionBtn label="Start Work" primary onPress={() => act(job, 'start')} />
                <ActionBtn label="Cancel" onPress={() => confirmCancel(job, role)} />
              </>
            )}
            {role === 'freelancer' && job.status === 'in_progress' && (
              <>
                <ActionBtn label="Mark Complete" primary onPress={() => confirmComplete(job)} />
                <ActionBtn label="Cancel" onPress={() => confirmCancel(job, role)} />
              </>
            )}
            {role === 'hirer' && unpaid && (
              <ActionBtn label="Check Payment" onPress={() => act(job, 'sync')} />
            )}
            {role === 'hirer' &&
              (job.status === 'pending' ||
                job.status === 'accepted' ||
                job.status === 'in_progress') && (
                <ActionBtn label="Cancel Job" onPress={() => confirmCancel(job, role)} />
              )}
          </View>
        )}
      </View>
    );
  };

  const showTabs = data?.isFreelancer ?? false;
  const jobs = tab === 'gigs' ? (data?.asFreelancer ?? []) : (data?.asHirer ?? []);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Freelance Jobs" subtitle="Escrow-protected gigs" />

      {showTabs && (
        <View style={styles.tabsRow}>
          {([
            { key: 'hiring', label: 'Hiring' },
            { key: 'gigs',   label: 'My Gigs' },
          ] as const).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[
                styles.tabBtn,
                tab === t.key && [styles.tabBtnActive, { backgroundColor: colors.accent, borderColor: colors.primary }],
              ]}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTab(t.key);
              }}
            >
              <Text style={[styles.tabText, tab === t.key && { color: FG }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SP.md + 4, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.centerBox}>
            <Feather name="briefcase" size={26} color={SUBTLE} />
            <Text style={styles.emptyTitle}>
              {tab === 'gigs' ? 'No gigs yet' : 'No hires yet'}
            </Text>
            <Text style={styles.emptyText}>
              {tab === 'gigs'
                ? 'Gigs appear here when a brand hires you on Brandthread.'
                : 'Hire a freelance creative to help build your streetwear brand.'}
            </Text>
            {tab === 'hiring' && (
              <TouchableOpacity
                style={[styles.browseBtn, { backgroundColor: colors.accent }]}
                activeOpacity={0.85}
                onPress={() => router.push('/community' as any)}
              >
                <Text style={[styles.browseBtnText, { color: colors.primary }]}>Browse Freelancers</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          jobs.map((j) => renderJob(j, tab === 'gigs' ? 'freelancer' : 'hirer'))
        )}
      </ScrollView>
    </View>
  );
}

function ActionBtn({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.actionBtn, primary && [styles.actionBtnPrimary, { backgroundColor: colors.primary, borderColor: colors.primary }]]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Text style={[styles.actionBtnText, primary && { color: colors.primaryForeground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  tabsRow: {
    flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md + 4, paddingTop: SP.md,
  },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: SP.sm + 2,
    borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  tabBtnActive: {},
  tabText: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.semibold },
  centerBox: { alignItems: 'center', gap: SP.sm, paddingVertical: SP.xl + 16 },
  emptyTitle: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  emptyText: {
    color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular,
    textAlign: 'center', paddingHorizontal: SP.xl,
  },
  browseBtn: {
    marginTop: SP.sm, paddingHorizontal: SP.lg,
    paddingVertical: SP.sm + 2, borderRadius: RADIUS.sm,
  },
  browseBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  card: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md,
    padding: SP.md - 2, marginBottom: SP.sm + 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  jobTitle: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold, flex: 1 },
  statusBadge: { paddingHorizontal: SP.sm + 2, paddingVertical: 4, borderRadius: RADIUS.pill },
  statusText: { fontSize: FS.xs, fontFamily: FONT.semibold },
  jobSub: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 4 },
  jobDesc: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm + 2 },
  price: { color: FG, fontSize: FS.base, fontFamily: FONT.bold },
  unpaidChip: {
    backgroundColor: ORANGE_DIM, paddingHorizontal: SP.sm, paddingVertical: 3,
    borderRadius: RADIUS.pill,
  },
  unpaidText: { color: ORANGE, fontSize: FS.xs, fontFamily: FONT.semibold },
  payoutNote: { color: SUCCESS, fontSize: FS.xs, fontFamily: FONT.medium },
  actionsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm + 4,
    minHeight: 34,
  },
  actionBtn: {
    paddingHorizontal: SP.md, paddingVertical: 8, borderRadius: RADIUS.sm,
    backgroundColor: BG, borderWidth: 1, borderColor: BORDER,
  },
  actionBtnPrimary: {},
  actionBtnText: { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold },
  waitingText: { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.regular, fontStyle: 'italic' },
});

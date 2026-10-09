/**
 * Invite friends — "Give $10. Get $10." Thread Cash referral screen.
 * Extends the original code/share/joined-list screen with the Thread Cash
 * reward, a how-it-works list, pending vs earned totals and per-friend status.
 * Layout reference (Mobbin): Cash App "$5 for you. $5 for a friend.", Klarna
 * numbered steps, Yami invite-history tiles. Timing copy lives in
 * lib/referralCopy.ts so every surface says the same thing.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { PrimaryButton, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CenteredToast } from '@/components/social/CenteredToast';
import {
  REFERRAL_HEADLINE, REFERRAL_STEPS, REFERRAL_SUBHEAD, referralStatusLabel,
} from '@/lib/referralCopy';

type InviteData = {
  code: string;
  link: string;
  shareText: string;
};

type Stats = {
  total: number;
  pointsEarned: number;
  clicks?: number;
  earnedCents?: number;
  pendingCents?: number;
  referrals: Array<{
    inviteeId: string;
    name: string | null;
    joinedAt: string;
    status?: string;
    rewardCents?: number;
  }>;
};

const DEMO_INVITE: InviteData = {
  code: 'K7M2QP',
  link: 'https://brandthread.app/invite/K7M2QP',
  shareText: 'Join Brandthread with my link and get $10 Thread Cash after your first order of $10 or more.',
};
const DEMO_STATS: Stats = {
  total: 3, pointsEarned: 1500, clicks: 12, earnedCents: 1000, pendingCents: 2000,
  referrals: [
    { inviteeId: 'd1', name: 'Amara Chen', joinedAt: new Date(Date.now() - 2 * 864e5).toISOString(), status: 'rewarded', rewardCents: 1000 },
    { inviteeId: 'd2', name: 'Jordan Reyes', joinedAt: new Date(Date.now() - 4 * 864e5).toISOString(), status: 'pending' },
    { inviteeId: 'd3', name: 'Sam Patel', joinedAt: new Date(Date.now() - 6 * 864e5).toISOString(), status: 'pending' },
  ],
};

export default function BuyerInviteScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const insets = useSafeAreaInsets();

  const [invite, setInvite] = useState<InviteData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, st] = await Promise.all([api.referrals.code(), api.referrals.stats()]);
      setInvite(inv as InviteData);
      setStats(st as Stats);
    } catch {
      if (isPreviewDemoMode()) {
        setInvite(DEMO_INVITE);
        setStats(DEMO_STATS);
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function copyCode() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(invite.code);
    showToast('Code copied');
  }

  async function copyLink() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(invite.link);
    showToast('Link copied');
  }

  async function shareInvite() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({ message: invite.shareText, url: invite.link });
    } catch {
      await copyLink();
    }
  }

  const pendingCents = stats?.pendingCents ?? 0;
  const earnedCents = stats?.earnedCents ?? 0;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Invite friends" />

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP.xl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{REFERRAL_HEADLINE}</Text>
            <Text style={styles.heroSub}>{REFERRAL_SUBHEAD}</Text>
          </View>

          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Your invite code</Text>
            <PressableScale style={styles.codeRow} onPress={copyCode} accessibilityLabel="Copy invite code">
              <Text style={styles.codeText}>{invite?.code ?? '------'}</Text>
              <View style={styles.copyPill}>
                <Feather name="copy" size={14} color={theme.text} />
                <Text style={styles.copyPillText}>Copy</Text>
              </View>
            </PressableScale>
          </View>

          <PrimaryButton
            label="Share invite link"
            icon="share-2"
            onPress={shareInvite}
            style={{ marginHorizontal: SP.md, marginTop: SP.md }}
          />

          <View style={styles.steps}>
            {REFERRAL_STEPS.map((step, i) => (
              <View key={step.title} style={styles.stepRow}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{stats?.total ?? 0}</Text>
              <Text style={styles.tileLabel}>{stats?.total === 1 ? 'Friend joined' : 'Friends joined'}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileValue}>{formatCents(pendingCents)}</Text>
              <Text style={styles.tileLabel}>Pending</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileValue, earnedCents > 0 && { color: theme.success }]}>{formatCents(earnedCents)}</Text>
              <Text style={styles.tileLabel}>Earned</Text>
            </View>
          </View>

          {(stats?.referrals ?? []).length > 0 && (
            <View style={styles.joinedCard}>
              <Text style={styles.sectionLabel}>Your friends</Text>
              {(stats?.referrals ?? []).slice(0, 10).map((r) => {
                const rewarded = r.status === 'rewarded';
                return (
                  <View key={r.inviteeId} style={styles.joinedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.joinedName} numberOfLines={1}>{r.name ?? 'Someone'}</Text>
                      <Text style={styles.joinedStatus}>
                        {referralStatusLabel(r.status ?? 'pending')}
                      </Text>
                    </View>
                    <Text style={[styles.joinedDate, rewarded && { color: theme.success }]}>
                      {rewarded
                        ? `+${formatCents(r.rewardCents ?? 1000)}`
                        : new Date(r.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                );
              })}
              {(stats?.total ?? 0) > 10 && (
                <Text style={styles.moreJoined}>+{(stats?.total ?? 0) - 10} more</Text>
              )}
            </View>
          )}
        </ScrollView>
      )}
      <CenteredToast message={toast} />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: SP.md },

  hero: { alignItems: 'center', paddingHorizontal: SP.xl, paddingTop: SP.lg, paddingBottom: SP.lg, gap: SP.sm },
  heroTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  heroSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 20 },

  codeCard: {
    marginHorizontal: SP.md,
    backgroundColor: theme.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.md,
    alignItems: 'center',
  },
  codeLabel: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm,
  },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  codeText: { fontSize: 32, fontFamily: FONT.bold, color: theme.text, letterSpacing: 6 },
  copyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: theme.accentDim, paddingHorizontal: 14, paddingVertical: SP.sm, borderRadius: RADIUS.pill,
  },
  copyPillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },

  steps: { marginHorizontal: SP.md, marginTop: SP.lg, gap: SP.md },
  stepRow: { flexDirection: 'row', gap: SP.md, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.text },
  stepTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  stepBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2, lineHeight: 19 },

  tiles: { flexDirection: 'row', gap: SP.sm, marginHorizontal: SP.md, marginTop: SP.lg },
  tile: {
    flex: 1, backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    paddingVertical: SP.md, paddingHorizontal: SP.sm, alignItems: 'center',
  },
  tileValue: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  tileLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2, textAlign: 'center' },

  joinedCard: {
    marginHorizontal: SP.md, marginTop: SP.md, backgroundColor: theme.card,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md, gap: SP.sm,
  },
  sectionLabel: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.8,
  },
  joinedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  joinedName: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  joinedStatus: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  joinedDate: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.subtle },
  moreJoined: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center' },
});

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PrimaryButton } from '@/components/BrandthreadUI';

type InviteData = {
  code: string;
  link: string;
  shareText: string;
};

type Stats = {
  total: number;
  pointsEarned: number;
  referrals: Array<{ inviteeId: string; name: string | null; joinedAt: string }>;
};

export default function BuyerInviteScreen() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const api     = useApi();

  const [invite, setInvite]         = useState<InviteData | null>(null);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [copied, setCopied]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, st] = await Promise.all([
        api.referrals.code(),
        api.referrals.stats(),
      ]);
      setInvite(inv as InviteData);
      setStats(st as Stats);
    } catch {
      // Non-fatal — show empty state
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function copyCode() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(invite.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyLink() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(invite.link);
    Alert.alert('Copied!', 'Invite link copied to clipboard.');
  }

  async function shareInvite() {
    if (!invite) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        // expo-sharing needs a file; use RN Share for text
        const { Share } = await import('react-native');
        await Share.share({ message: invite.shareText, url: invite.link });
      } else {
        await copyLink();
      }
    } catch {
      await copyLink();
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Friends</Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={PURPLE} />
        </View>
      ) : (
        <View style={styles.content}>
          {/* Hero */}
          <LinearGradient
            colors={[theme.accentDim, BG]}
            style={styles.hero}
          >
            <View style={styles.giftIconWrap}>
              <Feather name="gift" size={40} color={PURPLE} />
            </View>
            <Text style={styles.heroTitle}>Invite to Brandthread</Text>
            <Text style={styles.heroSub}>
              Share your invite code with friends. Earn 500 points when a new friend joins with your code.
            </Text>
          </LinearGradient>

          {/* Invite code card */}
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Your invite code</Text>
            <TouchableOpacity style={styles.codeRow} onPress={copyCode} activeOpacity={0.8}>
              <Text style={styles.codeText}>{invite?.code ?? '------'}</Text>
              <View style={styles.copyPill}>
                <Feather
                  name={copied ? 'check' : 'copy'}
                  size={14}
                  color={copied ? '#22C55E' : PURPLE}
                />
                <Text style={[styles.copyPillText, copied && { color: '#22C55E' }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </View>
            </TouchableOpacity>
            <Text style={styles.codeSub}>Tap to copy</Text>
          </View>

          {/* Share button */}
          <PrimaryButton label="Share invite link" icon="share-2" onPress={shareInvite} style={{ marginHorizontal: SP.md, marginBottom: SP.md }} />

          {/* Stats */}
          <View style={styles.statsCard}>
            <View style={styles.statRow}>
              <View style={styles.statIconWrap}>
                <Feather name="users" size={18} color={PURPLE} />
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statValue}>{stats?.total ?? 0}</Text>
                <Text style={styles.statLabel}>
                  {stats?.total === 1 ? 'friend joined' : 'friends joined'}
                </Text>
              </View>
              <View style={styles.pointsPill}>
                <Text style={styles.pointsValue}>{stats?.pointsEarned ?? 0}</Text>
                <Text style={styles.pointsLabel}>points earned</Text>
              </View>
            </View>

            {(stats?.referrals ?? []).length > 0 && (
              <View style={styles.joinedList}>
                {(stats?.referrals ?? []).slice(0, 5).map((r, i) => (
                  <View key={r.inviteeId} style={styles.joinedRow}>
                    <View style={styles.joinedDot} />
                    <Text style={styles.joinedName}>
                      {r.name ?? 'Someone'} joined
                    </Text>
                    <Text style={styles.joinedDate}>
                      {new Date(r.joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                ))}
                {(stats?.total ?? 0) > 5 && (
                  <Text style={styles.moreJoined}>+{(stats?.total ?? 0) - 5} more</Text>
                )}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: { accent: string; accentDim: string }) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: SP.md,
    paddingVertical:   SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn:    { width: 36, alignItems: 'flex-start' },
  headerBtn:  { width: 36 },
  headerTitle: {
    flex:       1,
    textAlign:  'center',
    fontSize:   FS.base,
    fontFamily: FONT.semibold,
    color:      FG,
  },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },

  // Hero
  hero: {
    alignItems:     'center',
    paddingTop:     SP.xl,
    paddingBottom:  SP.lg,
    paddingHorizontal: SP.xl,
    gap: SP.sm,
  },
  giftIconWrap: {
    width:  80, height: 80,
    borderRadius: 40,
    backgroundColor: theme.accentDim,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SP.sm,
  },
  heroTitle: {
    fontSize:   FS.xl,
    fontFamily: FONT.bold,
    color:      FG,
    textAlign:  'center',
  },
  heroSub: {
    fontSize:   FS.sm,
    fontFamily: FONT.regular,
    color:      MUTED,
    textAlign:  'center',
    lineHeight: 20,
  },

  // Code card
  codeCard: {
    marginHorizontal: SP.md,
    marginTop:        SP.lg,
    backgroundColor:  CARD,
    borderRadius:     RADIUS.lg,
    borderWidth:      1,
    borderColor:      BORDER,
    padding:          SP.md,
    alignItems:       'center',
  },
  codeLabel: {
    fontSize:   FS.xs,
    fontFamily: FONT.semibold,
    color:      MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SP.sm,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SP.md,
  },
  codeText: {
    fontSize:   36,
    fontFamily: FONT.bold,
    color:      FG,
    letterSpacing: 6,
  },
  copyPill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             4,
    backgroundColor: theme.accentDim,
    paddingHorizontal: SP.sm,
    paddingVertical:   SP.xs,
    borderRadius:    RADIUS.pill,
  },
  copyPillText: {
    fontSize:   FS.xs,
    fontFamily: FONT.semibold,
    color:      theme.accent,
  },
  codeSub: {
    marginTop:  SP.xs,
    fontSize:   FS.xs,
    fontFamily: FONT.regular,
    color:      SUBTLE,
  },

  // Stats card
  statsCard: {
    marginHorizontal: SP.md,
    marginTop:        SP.md,
    backgroundColor:  CARD,
    borderRadius:     RADIUS.lg,
    borderWidth:      1,
    borderColor:      BORDER,
    padding:          SP.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SP.md,
  },
  statIconWrap: {
    width:  40, height: 40,
    borderRadius: 20,
    backgroundColor: theme.accentDim,
    alignItems: 'center', justifyContent: 'center',
  },
  statContent: { flex: 1 },
  pointsPill: {
    alignItems: 'flex-end',
    backgroundColor: theme.accentDim,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  pointsValue: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.accent },
  pointsLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  statValue: {
    fontSize:   FS.xl,
    fontFamily: FONT.bold,
    color:      FG,
  },
  statLabel: {
    fontSize:   FS.sm,
    fontFamily: FONT.regular,
    color:      MUTED,
  },
  joinedList: {
    marginTop:  SP.md,
    gap:        SP.xs,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop:     SP.sm,
  },
  joinedRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SP.sm,
  },
  joinedDot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  joinedName: {
    flex:       1,
    fontSize:   FS.sm,
    fontFamily: FONT.regular,
    color:      FG,
  },
  joinedDate: {
    fontSize:   FS.xs,
    fontFamily: FONT.regular,
    color:      SUBTLE,
  },
  moreJoined: {
    marginTop:  SP.xs,
    fontSize:   FS.xs,
    fontFamily: FONT.regular,
    color:      MUTED,
    textAlign:  'center',
  },
});

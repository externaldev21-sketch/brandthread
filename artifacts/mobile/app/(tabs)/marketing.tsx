import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { SectionHeader } from '@/components/SectionHeader';
import { Badge } from '@/components/Badge';
import { EmptyState, IconButton, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { FS, FONT, SP, COMP, ICON } from '@/lib/theme';
import { useApi } from '@/hooks/useApi';
import { formatCents } from '@/lib/money';
import type { AdCampaign } from '@/lib/api';
import { useScrollReset } from '@/hooks/useScrollReset';
import { RetryRow } from '@/components/ui/RetryRow';
import { isSellerDevPreview } from '@/lib/devPreview';

type KlaviyoStatus = {
  connected: boolean;
  companyName?: string | null;
  emailSubscriberCount?: number;
  smsSubscriberCount?: number;
};

type DiscountCode = {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  usageCount: number;
  usageLimit?: number;
  expiresAt?: string;
};

type ReferralStats = {
  total: number;
  pointsEarned: number;
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function campaignStatusVariant(s: AdCampaign['status']) {
  if (s === 'active') return 'success';
  if (s === 'pending_payment') return 'info';
  if (s === 'failed' || s === 'cancelled') return 'warning';
  return 'default';
}

function campaignStatusLabel(s: AdCampaign['status']) {
  if (s === 'pending_payment') return 'pending payment';
  return s;
}

function discountValueLabel(d: DiscountCode) {
  return d.type === 'percentage' ? `${d.value}% off` : `${formatCents(d.value)} off`;
}

function discountExpiryLabel(d: DiscountCode) {
  if (!d.expiresAt) return 'No expiry';
  const date = new Date(d.expiresAt);
  return `${date < new Date() ? 'Expired' : 'Expires'} ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export default function MarketingScreen() {
  const scrollResetRef = useScrollReset<ScrollView>();
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [klaviyo, setKlaviyo] = useState<KlaviyoStatus | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [campaignsError, setCampaignsError] = useState(false);
  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [discountsError, setDiscountsError] = useState(false);
  const [referrals, setReferrals] = useState<ReferralStats | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const retryAll = useCallback(() => setReloadToken((n) => n + 1), []);

  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.integrations.klaviyoStatus()
        .then((res) => { if (!cancelled) setKlaviyo(res); })
        .catch(() => { if (!cancelled) setKlaviyo({ connected: false }); });
      api.adCampaigns.list()
        .then((res) => { if (!cancelled) { setCampaigns(Array.isArray(res?.campaigns) ? res.campaigns : []); setCampaignsError(false); } })
        // A failed fetch on a real, authenticated account must never
        // collapse into "No campaigns yet" — that reads as a real,
        // permanent empty state instead of a retryable outage. But a dev
        // web preview has no real signed-in account behind it at all, so a
        // 401/404 there is expected and benign, not a genuine failure —
        // show the normal empty state instead of an error banner.
        .catch(() => { if (!cancelled) { setCampaigns([]); setCampaignsError(!isSellerDevPreview()); } });
      api.discountCodes.list()
        .then((res) => { if (!cancelled) { setDiscounts(Array.isArray(res) ? (res as DiscountCode[]) : []); setDiscountsError(false); } })
        .catch(() => { if (!cancelled) { setDiscounts([]); setDiscountsError(!isSellerDevPreview()); } });
      api.referrals.stats()
        .then((res) => { if (!cancelled) setReferrals({ total: res.total ?? 0, pointsEarned: res.pointsEarned ?? 0 }); })
        .catch(() => { if (!cancelled) setReferrals(null); });
      return () => { cancelled = true; };
    }, [api, reloadToken]),
  );

  const copyDiscountCode = useCallback(async (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(code);
  }, []);

  return (
    <View style={{ flex: 1 }}>
    <ScreenHeader
      title="Marketing"
      onBack={() => router.push('/(tabs)/more' as never)}
      rightElement={(
        <PressableScale
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(tabs)/analytics' as never); }}
          accessibilityRole="button"
          accessibilityLabel="View analytics"
        >
          <Feather name="bar-chart-2" size={ICON.md} color={colors.foreground} />
        </PressableScale>
      )}
    />
    <ScrollView
      ref={scrollResetRef}
      style={[styles.container, { backgroundColor: 'transparent' }]}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Stats Row — flat, no card/border boxes; a single hairline divider
          under the row and a hairline between the two chips is the only
          separation (Dev's standing "no grey boxes" rule). */}
      <View style={[styles.statsRow, { borderBottomColor: colors.border }]}>
        {[
          { label: 'Email Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.emailSubscriberCount ?? 0) : '0', icon: 'mail' as const },
          { label: 'SMS Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.smsSubscriberCount ?? 0) : '0', icon: 'message-square' as const },
        ].map((s, i) => (
          <View key={s.label} style={[styles.statChip, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
            <Feather name={s.icon} size={14} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Connect Klaviyo */}
      <TouchableOpacity
        style={[styles.klaviyoBtn, { backgroundColor: klaviyo?.connected ? colors.card : colors.primary, borderColor: colors.border, borderWidth: klaviyo?.connected ? 1 : 0 }]}
        activeOpacity={0.85}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push('/integrations/klaviyo' as never);
        }}
      >
        <Feather name={klaviyo?.connected ? 'check-circle' : 'zap'} size={16} color={klaviyo?.connected ? colors.success : colors.primaryForeground} />
        <Text style={[styles.klaviyoText, { color: klaviyo?.connected ? colors.foreground : colors.primaryForeground }]}>
          {klaviyo?.connected ? `Klaviyo connected${klaviyo.companyName ? ` · ${klaviyo.companyName}` : ''}` : 'Connect Klaviyo: Email Marketing & SMS'}
        </Text>
      </TouchableOpacity>

      {/* Campaigns */}
      <SectionHeader
        title="Campaigns"
        action="New +"
        onAction={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/design-campaign' as never); }}
      />
      {campaignsError ? (
        <View style={styles.emptyFlat}>
          <RetryRow label="Couldn't load campaigns" onRetry={retryAll} />
        </View>
      ) : campaigns.length === 0 ? (
        <EmptyState
          compact
          icon="tv"
          title="No campaigns yet"
          description="Create a Meta ad to put your products in front of new buyers."
          style={styles.emptyFlat}
          action={{ label: 'Create a campaign', icon: 'plus', onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/design-campaign' as never);
          } }}
        />
      ) : (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {campaigns.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/design-campaign?campaignId=${c.id}` as never)}
              style={[styles.campaignRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={[styles.campaignIcon, { backgroundColor: colors.accent }]}>
                <Feather name="tv" size={16} color={colors.primary} />
              </View>
              <View style={styles.campaignInfo}>
                <Text style={[styles.campaignName, { color: colors.foreground }]} numberOfLines={1}>
                  {c.headline?.trim() || 'Untitled campaign'}
                </Text>
                <View style={styles.campaignMeta}>
                  <Badge label={campaignStatusLabel(c.status)} variant={campaignStatusVariant(c.status) as any} />
                </View>
              </View>
              <Text style={[styles.campaignRevenue, { color: colors.primary }]}>{formatCents(c.budgetCents)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Discount Codes */}
      <SectionHeader
        title="Discount Codes"
        action="New +"
        onAction={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/discounts' as never); }}
      />
      {discountsError ? (
        <View style={styles.emptyFlat}>
          <RetryRow label="Couldn't load discount codes" onRetry={retryAll} />
        </View>
      ) : discounts.length === 0 ? (
        <EmptyState
          compact
          icon="percent"
          title="No discount codes yet"
          description="Codes give buyers a reason to check out now instead of later."
          style={styles.emptyFlat}
          action={{ label: 'Create a discount', icon: 'plus', onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/discounts' as never);
          } }}
        />
      ) : (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {discounts.slice(0, 5).map((d, i) => (
            <View key={d.id} style={[styles.discountRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.codeWrap, { backgroundColor: colors.accent }]}>
                <Text style={[styles.code, { color: colors.primary }]}>{d.code}</Text>
              </View>
              <View style={styles.discountInfo}>
                <Text style={[styles.discountType, { color: colors.foreground }]}>{discountValueLabel(d)}</Text>
                <Text style={[styles.discountMeta, { color: colors.mutedForeground }]}>
                  {d.usageCount} uses{d.usageLimit != null ? ` / ${d.usageLimit}` : ''} · {discountExpiryLabel(d)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => copyDiscountCode(d.code)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Copy code ${d.code}`}
              >
                <Feather name="copy" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Referral */}
      <SectionHeader title="Referral Program" />
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/buyer-invite' as never); }}
        style={[styles.referralCard, { backgroundColor: colors.card, borderColor: colors.primary }]}
      >
        <Feather name="share-2" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.referralTitle, { color: colors.foreground }]}>Invite and earn</Text>
          <Text style={[styles.referralSub, { color: colors.mutedForeground }]}>
            {referrals == null
              ? 'Share your invite link'
              : referrals.total > 0
                ? `${referrals.total} ${referrals.total === 1 ? 'referral' : 'referrals'} · ${referrals.pointsEarned} pts earned`
                : 'No referrals yet'}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.primary} />
      </TouchableOpacity>

      {/* Follower push + giveaways */}
      <SectionHeader title="Reach your followers" />
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/seller-push-broadcast' as never); }}
        style={[styles.referralCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Follower push"
      >
        <Feather name="bell" size={24} color={colors.foreground} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.referralTitle, { color: colors.foreground }]}>Follower push</Text>
          <Text style={[styles.referralSub, { color: colors.mutedForeground }]}>One push to your followers per day</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/seller-giveaways' as never); }}
        style={[styles.referralCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Giveaways"
      >
        <Feather name="gift" size={24} color={colors.foreground} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.referralTitle, { color: colors.foreground }]}>Giveaways</Text>
          <Text style={[styles.referralSub, { color: colors.mutedForeground }]}>Follow and comment to enter</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs, minHeight: COMP.headerH },
  pageTitle: { fontSize: FS.xl, fontFamily: FONT.bold, letterSpacing: -0.3, marginBottom: 2 },
  pageSubtitle: { fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 20 },
  statsRow: { flexDirection: 'row', paddingBottom: SP.md, marginBottom: 24, borderBottomWidth: StyleSheet.hairlineWidth },
  statChip: { flex: 1, paddingVertical: 12, alignItems: 'center', gap: 4, minHeight: COMP.minTouchTarget },
  statVal: { fontSize: FS.base, fontFamily: FONT.bold },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.regular },
  klaviyoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 24, minHeight: COMP.buttonH },
  klaviyoText: { fontSize: FS.sm, fontFamily: FONT.semibold, textAlign: 'center' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  emptyFlat: { marginBottom: 24 },
  emptyText: { fontSize: FS.sm, fontFamily: FONT.regular },
  campaignRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, minHeight: COMP.minTouchTarget },
  campaignIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  campaignInfo: { flex: 1, gap: 4 },
  campaignName: { fontSize: FS.sm, fontFamily: FONT.semibold },
  campaignMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campaignStat: { fontSize: FS.xs, fontFamily: FONT.regular },
  campaignRevenue: { fontSize: FS.sm, fontFamily: FONT.bold },
  discountRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  codeWrap: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  code: { fontSize: FS.meta, fontFamily: FONT.bold, letterSpacing: 1 },
  discountInfo: { flex: 1 },
  discountType: { fontSize: FS.sm, fontFamily: FONT.semibold },
  discountMeta: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  postRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  dayBadge: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: FS.xs, fontFamily: FONT.bold },
  postInfo: { flex: 1 },
  postText: { fontSize: FS.sm, fontFamily: FONT.medium },
  postPlatform: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  autoRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  autoInfo: { flex: 1 },
  autoName: { fontSize: FS.sm, fontFamily: FONT.semibold },
  autoTrigger: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  referralCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 16, borderWidth: 1, gap: 14, marginBottom: 24 },
  referralTitle: { fontSize: FS.sm, fontFamily: FONT.semibold },
  referralSub: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
});

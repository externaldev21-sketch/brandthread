import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '@/components/SectionHeader';
import { Badge } from '@/components/Badge';
import { EmptyState, IconButton } from '@/components/BrandthreadUI';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { FS, FONT, SP, COMP } from '@/lib/theme';
import { useApi } from '@/hooks/useApi';
import { formatCents } from '@/lib/money';
import type { AdCampaign } from '@/lib/api';
import { useScrollReset } from '@/hooks/useScrollReset';

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [klaviyo, setKlaviyo] = useState<KlaviyoStatus | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [referrals, setReferrals] = useState<ReferralStats | null>(null);

  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.integrations.klaviyoStatus()
        .then((res) => { if (!cancelled) setKlaviyo(res); })
        .catch(() => { if (!cancelled) setKlaviyo({ connected: false }); });
      api.adCampaigns.list()
        .then((res) => { if (!cancelled) setCampaigns(Array.isArray(res?.campaigns) ? res.campaigns : []); })
        .catch(() => { if (!cancelled) setCampaigns([]); });
      api.discountCodes.list()
        .then((res) => { if (!cancelled) setDiscounts(Array.isArray(res) ? (res as DiscountCode[]) : []); })
        .catch(() => { if (!cancelled) setDiscounts([]); });
      api.referrals.stats()
        .then((res) => { if (!cancelled) setReferrals({ total: res.total ?? 0, pointsEarned: res.pointsEarned ?? 0 }); })
        .catch(() => { if (!cancelled) setReferrals(null); });
      return () => { cancelled = true; };
    }, [api]),
  );

  const copyDiscountCode = useCallback(async (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(code);
  }, []);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      ref={scrollResetRef}
      style={[styles.container, { backgroundColor: 'transparent' }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <IconButton
          name="chevron-left"
          onPress={() => router.push('/(tabs)/more' as never)}
          accessibilityLabel="Back"
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Marketing</Text>
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Campaigns, discounts & automation</Text>
        </View>
        <IconButton
          name="bar-chart-2"
          onPress={() => router.push('/(tabs)/analytics' as never)}
          accessibilityLabel="View analytics"
        />
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Email Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.emailSubscriberCount ?? 0) : '0', icon: 'mail' as const },
          { label: 'SMS Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.smsSubscriberCount ?? 0) : '0', icon: 'message-square' as const },
        ].map((s) => (
          <View key={s.label} style={[styles.statChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
      {campaigns.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <EmptyState
            compact
            icon="tv"
            title="No campaigns yet"
            description="Create a Meta ad to put your products in front of new buyers."
            action={{ label: 'Create a campaign', icon: 'plus', onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/design-campaign' as never);
            } }}
          />
        </View>
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
      {discounts.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <EmptyState
            compact
            icon="percent"
            title="No discount codes yet"
            description="Codes give buyers a reason to check out now instead of later."
            action={{ label: 'Create a discount', icon: 'plus', onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/discounts' as never);
            } }}
          />
        </View>
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
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs, minHeight: COMP.headerH },
  pageTitle: { fontSize: FS.xl, fontFamily: FONT.bold, letterSpacing: -0.3, marginBottom: 2 },
  pageSubtitle: { fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  statChip: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4, minHeight: COMP.minTouchTarget },
  statVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
  klaviyoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 24, minHeight: COMP.buttonH },
  klaviyoText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  emptyCard: { borderRadius: 14, borderWidth: 1, marginBottom: 24, overflow: 'hidden' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  campaignRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, minHeight: COMP.minTouchTarget },
  campaignIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  campaignInfo: { flex: 1, gap: 4 },
  campaignName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  campaignMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  campaignStat: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  campaignRevenue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  discountRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  codeWrap: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  code: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  discountInfo: { flex: 1 },
  discountType: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  discountMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  postRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  dayBadge: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  postInfo: { flex: 1 },
  postText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  postPlatform: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  autoRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  autoInfo: { flex: 1 },
  autoName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  autoTrigger: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  referralCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 16, borderWidth: 1, gap: 14, marginBottom: 24 },
  referralTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  referralSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});

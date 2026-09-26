/**
 * Marketing Analytics — Brandthread Seller App
 *
 * Mobbin reference: Shopify "Marketing" channel-card grid + Revolut Business
 * hero-metric card (https://mobbin.com/screens/6122bfe2-f660-4354-8c46-545ed12c96ba,
 * https://mobbin.com/screens/4cbc7fb1-eaaa-4067-9e4b-d42b9cb4a7bf) informed the
 * hero revenue card and per-channel revenue-share bars below it.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getMarketingAnalytics, getFilterState } from '@/services/analyticsService';
import { MarketingAnalytics, CampaignAnalytics, InfluencerAnalytics, AnalyticsFilterState } from '@/services/analyticsTypes';
import { formatCents } from '@/lib/money';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, HeaderPillButton,
  ProgressBar, SectionTitle,
} from '@/components/analytics/AnalyticsKit';

function RevenueBar({ label, valueCents, totalCents, color }: { label: string; valueCents: number; totalCents: number; color: string }) {
  const colors = useColors();
  const pct = totalCents > 0 ? Math.round((valueCents / totalCents) * 100) : 0;
  return (
    <View style={{ marginBottom: SP.sm + 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground }}>{label}</Text>
        <Text style={{ fontSize: FS.xs, fontFamily: FONT.bold, color: colors.foreground }}>
          {formatCents(valueCents)} <Text style={{ color: colors.subtle }}>({pct}%)</Text>
        </Text>
      </View>
      <ProgressBar pct={pct} color={color} />
    </View>
  );
}

function CampaignRow({ c }: { c: CampaignAnalytics }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const typeColor = c.type === 'email' ? colors.primary : c.type === 'sms' ? colors.success : c.type === 'push' ? colors.info : colors.warning;
  const typeIcon: keyof typeof Feather.glyphMap = c.type === 'email' ? 'mail' : c.type === 'sms' ? 'message-square' : c.type === 'push' ? 'bell' : 'zap';
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/marketing' as never); }}
      style={s.rowItem}
      activeOpacity={0.8}
    >
      <View style={[s.rowIcon, { backgroundColor: typeColor + '22' }]}>
        <Feather name={typeIcon} size={14} color={typeColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{c.name}</Text>
        <Text style={s.rowMeta}>{c.recipients.toLocaleString()} sent · {c.orders} orders</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.rowValue}>{formatCents(c.revenueCents)}</Text>
        <Text style={[s.rowSub, { color: colors.success }]}>{formatCents(c.revenuePerRecipientCents)}/rec.</Text>
      </View>
    </TouchableOpacity>
  );
}

function InfluencerRow({ inf }: { inf: InfluencerAnalytics }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.rowItem}>
      <View style={s.avatar}>
        <Text style={s.avatarInitial}>{inf.name.slice(1, 2).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{inf.name}</Text>
        <Text style={s.rowMeta}>{inf.orders} orders · {inf.clicks.toLocaleString()} clicks</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.rowValue}>{formatCents(inf.revenueCents)}</Text>
        <Text style={[s.rowSub, { color: inf.returnOnCost >= 5 ? colors.success : colors.warning }]}>{inf.returnOnCost}× ROC</Text>
      </View>
    </View>
  );
}

export default function AnalyticsMarketingScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<MarketingAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getMarketingAnalytics(f);
      if (requestUser.current !== requestedUser) return;
      setData(next);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  const totalMarketing = data?.marketingRevenue.value ?? 1;

  if (loading) {
    return <AnalyticsSkeleton topPad={topPad} kpiCount={0} listRows={3} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader
        title="Marketing Analytics"
        subtitle={filter?.dateRange.label ?? '30 days'}
        right={<HeaderPillButton label="Marketing" onPress={() => router.push('/(tabs)/marketing' as never)} />}
      />

      {!data ? (
        <EmptyState
          icon="mail"
          title="Marketing insights are on the way"
          description="We'll show channel revenue once campaigns start driving sales."
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <>
          {/* Revenue hero */}
          <View style={s.heroCard}>
            <Text style={s.heroLabel}>Marketing Revenue</Text>
            <Text style={s.heroValue}>{data.marketingRevenue.formatted}</Text>
            {typeof data.marketingRevenue.changePct === 'number' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Feather name="trending-up" size={12} color={colors.success} />
                <Text style={s.heroChange}>+{data.marketingRevenue.changePct.toFixed(1)}% vs prev period</Text>
              </View>
            )}
          </View>

          {/* Revenue by channel */}
          <SectionTitle>Revenue by Channel</SectionTitle>
          <Card padded>
            <RevenueBar label="Email"      valueCents={data.emailRevenue.value}      totalCents={totalMarketing} color={colors.primary} />
            <RevenueBar label="Discounts"  valueCents={data.discountRevenue.value}   totalCents={totalMarketing} color={colors.warning} />
            <RevenueBar label="SMS"        valueCents={data.smsRevenue.value}        totalCents={totalMarketing} color={colors.success} />
            <RevenueBar label="Automation" valueCents={data.automationRevenue.value} totalCents={totalMarketing} color={colors.info} />
            <RevenueBar label="Influencers" valueCents={data.influencerRevenue.value} totalCents={totalMarketing} color={colors.warning} />
            <RevenueBar label="Referrals"  valueCents={data.referralRevenue.value}   totalCents={totalMarketing} color={colors.info} />
            <View style={s.recoveredRow}>
              <Feather name="refresh-cw" size={13} color={colors.success} />
              <Text style={s.recoveredText}>Abandoned cart recovered:</Text>
              <Text style={[s.recoveredAmount, { color: colors.success }]}>{data.abandonedCheckoutRecovered.formatted}</Text>
            </View>
          </Card>

          {/* Campaigns */}
          <SectionTitle>Campaign Performance</SectionTitle>
          {data.campaigns.length === 0 ? (
            <EmptyState icon="mail" title="No campaigns yet" description="Campaign performance will appear after campaigns are sent." />
          ) : (
            <Card>
              {data.campaigns.map((c, i) => (
                <View key={c.campaignId}>
                  {i > 0 && <CardDivider />}
                  <CampaignRow c={c} />
                </View>
              ))}
            </Card>
          )}

          {/* Influencers */}
          <SectionTitle>Influencer Performance</SectionTitle>
          {data.influencers.length === 0 ? (
            <EmptyState icon="users" title="No influencer activity yet" description="Influencer performance will appear once a partnership drives sales." />
          ) : (
            <Card>
              {data.influencers.map((inf, i) => (
                <View key={inf.influencerId}>
                  {i > 0 && <CardDivider />}
                  <InfluencerRow inf={inf} />
                </View>
              ))}
            </Card>
          )}

          {/* Referral */}
          <SectionTitle>Referral Program</SectionTitle>
          <Card>
            {[
              { label: 'Shares',             value: data.referral.shares.toLocaleString() },
              { label: 'Clicks',             value: data.referral.clicks.toLocaleString() },
              { label: 'Referred Customers', value: data.referral.referredCustomers.toLocaleString() },
              { label: 'Revenue',            value: formatCents(data.referral.revenueCents) },
              { label: 'Rewards Issued',     value: formatCents(data.referral.rewardsIssuedCents) },
            ].map((item, i) => (
              <View key={item.label}>
                {i > 0 && <CardDivider />}
                <View style={s.simpleRow}>
                  <Text style={s.simpleLabel}>{item.label}</Text>
                  <Text style={s.simpleValue}>{item.value}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  heroCard: { backgroundColor: colors.elevated, borderRadius: RADIUS.lg, padding: SP.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg, alignItems: 'center' },
  heroLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: SP.sm },
  heroValue:{ fontSize: 40, fontFamily: FONT.bold, color: colors.foreground },
  heroChange:{ fontSize: FS.xs, fontFamily: FONT.medium, color: colors.success },
  recoveredRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  recoveredText:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  recoveredAmount:{ fontSize: FS.sm, fontFamily: FONT.bold },
  rowItem:{ flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md, paddingVertical: SP.sm + 1, gap: SP.sm },
  rowIcon:{ width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  rowTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 2 },
  rowMeta:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  rowValue:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  rowSub:{ fontSize: FS.xs, fontFamily: FONT.regular },
  avatar:{ width: 36, height: 36, borderRadius: RADIUS.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:{ fontSize: FS.sm, fontFamily: FONT.bold, color: colors.accentForeground },
  simpleRow:{ flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md, paddingVertical: SP.sm + 1 },
  simpleLabel:{ flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  simpleValue:{ fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
});

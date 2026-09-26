/**
 * Marketing Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, BLUE, BLUE_DIM, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getMarketingAnalytics, getFilterState } from '@/services/analyticsService';
import { MarketingAnalytics, CampaignAnalytics, InfluencerAnalytics, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';
import { formatCents } from '@/lib/money';
import { EmptyState } from '@/components/BrandthreadUI';

function RevenueBar({ label, valueCents, totalCents, color }: { label: string; valueCents: number; totalCents: number; color: string }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const pct = totalCents > 0 ? Math.round((valueCents / totalCents) * 100) : 0;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={{ fontSize: 12, fontFamily: FONT.medium, color: MUTED }}>{label}</Text>
        <Text style={{ fontSize: 12, fontFamily: FONT.bold, color: FG }}>{formatCents(valueCents)} <Text style={{ color: SUBTLE }}>({pct}%)</Text></Text>
      </View>
      <View style={{ height: 6, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

function CampaignRow({ c }: { c: CampaignAnalytics }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const typeColor = c.type === 'email' ? PURPLE : c.type === 'sms' ? SUCCESS : c.type === 'push' ? BLUE : ORANGE;
  const typeIcon: keyof typeof Feather.glyphMap = c.type === 'email' ? 'mail' : c.type === 'sms' ? 'message-square' : c.type === 'push' ? 'bell' : 'zap';
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push('/(tabs)/marketing' as never); }}
      style={s.campaignRow}
      activeOpacity={0.8}
    >
      <View style={[s.campaignIcon, { backgroundColor: typeColor + '22' }]}>
        <Feather name={typeIcon} size={14} color={typeColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.campaignName} numberOfLines={1}>{c.name}</Text>
        <Text style={s.campaignMeta}>{c.recipients.toLocaleString()} sent · {c.orders} orders</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.campaignRevenue}>{formatCents(c.revenueCents)}</Text>
        <Text style={s.campaignRate}>{formatCents(c.revenuePerRecipientCents)}/rec.</Text>
      </View>
    </TouchableOpacity>
  );
}

function InfluencerRow({ inf }: { inf: InfluencerAnalytics }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={s.influencerRow}>
      <View style={s.influencerAvatar}>
        <Text style={s.influencerInitial}>{inf.name.slice(1, 2).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.influencerName}>{inf.name}</Text>
        <Text style={s.influencerMeta}>{inf.orders} orders · {inf.clicks.toLocaleString()} clicks</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.influencerRevenue}>{formatCents(inf.revenueCents)}</Text>
        <Text style={[s.influencerROC, { color: inf.returnOnCost >= 5 ? SUCCESS : ORANGE }]}>{inf.returnOnCost}× ROC</Text>
      </View>
    </View>
  );
}

export default function AnalyticsMarketingScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = insets.top;

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
    return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><ActivityIndicator size="large" color={PURPLE} /></View>;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>Marketing Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/(tabs)/marketing' as never)} style={s.mktgBtn}>
          <Text style={s.mktgBtnText}>Marketing</Text>
        </TouchableOpacity>
      </View>

      {/* Revenue hero */}
      <View style={s.heroCard}>
        <Text style={s.heroLabel}>Marketing Revenue</Text>
        <Text style={s.heroValue}>{data?.marketingRevenue.formatted ?? '—'}</Text>
        {typeof data?.marketingRevenue.changePct === 'number' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Feather name="trending-up" size={12} color={SUCCESS} />
            <Text style={s.heroChange}>+{data.marketingRevenue.changePct.toFixed(1)}% vs prev period</Text>
          </View>
        )}
      </View>

      {/* Revenue by channel */}
      <Text style={s.sectionTitle}>Revenue by Channel</Text>
      <View style={[s.card, { padding: 16 }]}>
        {data && <>
          <RevenueBar label="Email"         valueCents={data.emailRevenue.value}        totalCents={totalMarketing} color={PURPLE}  />
          <RevenueBar label="Discounts"     valueCents={data.discountRevenue.value}     totalCents={totalMarketing} color={GOLD}    />
          <RevenueBar label="SMS"           valueCents={data.smsRevenue.value}          totalCents={totalMarketing} color={SUCCESS} />
          <RevenueBar label="Automation"    valueCents={data.automationRevenue.value}   totalCents={totalMarketing} color={BLUE}    />
          <RevenueBar label="Influencers"   valueCents={data.influencerRevenue.value}   totalCents={totalMarketing} color={ORANGE}  />
          <RevenueBar label="Referrals"     valueCents={data.referralRevenue.value}     totalCents={totalMarketing} color={CYAN} />
        </>}
        <View style={s.recoveredRow}>
          <Feather name="refresh-cw" size={13} color={SUCCESS} />
          <Text style={s.recoveredText}>Abandoned cart recovered:</Text>
          <Text style={[s.recoveredAmount, { color: SUCCESS }]}>{data?.abandonedCheckoutRecovered.formatted}</Text>
        </View>
      </View>

      {/* Campaigns */}
      <Text style={s.sectionTitle}>Campaign Performance</Text>
      {data?.campaigns.length === 0 ? (
        <EmptyState
          icon="mail"
          title="No campaigns yet"
          description="Campaign performance will appear after campaigns are sent."
        />
      ) : (
        <View style={s.card}>
          {data?.campaigns.map((c, i) => (
            <View key={c.campaignId}>
              {i > 0 && <View style={s.divider} />}
              <CampaignRow c={c} />
            </View>
          ))}
        </View>
      )}

      {/* Influencers */}
      <Text style={s.sectionTitle}>Influencer Performance</Text>
      {!data || data.influencers.length === 0 ? (
        <EmptyState
          icon="users"
          title="No influencer activity yet"
          description="Influencer performance will appear once a partnership drives sales."
        />
      ) : (
        <View style={s.card}>
          {data.influencers.map((inf, i) => (
            <View key={inf.influencerId}>
              {i > 0 && <View style={s.divider} />}
              <InfluencerRow inf={inf} />
            </View>
          ))}
        </View>
      )}

      {/* Referral */}
      <Text style={s.sectionTitle}>Referral Program</Text>
      <View style={s.card}>
        {[
          { label: 'Shares',              value: data?.referral.shares.toLocaleString() ?? '—' },
          { label: 'Clicks',              value: data?.referral.clicks.toLocaleString() ?? '—' },
          { label: 'Referred Customers',  value: data?.referral.referredCustomers.toLocaleString() ?? '—' },
          { label: 'Revenue',             value: data ? formatCents(data.referral.revenueCents) : '—' },
          { label: 'Rewards Issued',      value: data ? formatCents(data.referral.rewardsIssuedCents) : '—' },
        ].map((item, i) => (
          <View key={item.label} style={[s.simpleRow, i > 0 && s.divider]}>
            <Text style={s.simpleLabel}>{item.label}</Text>
            <Text style={s.simpleValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT } = colors;
  return StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  mktgBtn:  { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE },
  mktgBtnText:{ fontSize: 12, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  heroCard: { backgroundColor: CARD_ELEVATED, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: BORDER, marginBottom: 20, alignItems: 'center' },
  heroLabel:{ fontSize: 12, fontFamily: FONT.medium, color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  heroValue:{ fontSize: 40, fontFamily: FONT.bold, color: FG },
  heroChange:{ fontSize: 12, fontFamily: FONT.medium, color: SUCCESS },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  recoveredRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  recoveredText:{ fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  recoveredAmount:{ fontSize: 13, fontFamily: FONT.bold },
  campaignRow:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  campaignIcon:{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  campaignName:{ fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  campaignMeta:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  campaignRevenue:{ fontSize: 14, fontFamily: FONT.bold, color: FG },
  campaignRate:{ fontSize: 11, fontFamily: FONT.regular, color: SUCCESS },
  influencerRow:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  influencerAvatar:{ width: 36, height: 36, borderRadius: 18, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  influencerInitial:{ fontSize: 14, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  influencerName:{ fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 2 },
  influencerMeta:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  influencerRevenue:{ fontSize: 14, fontFamily: FONT.bold, color: FG },
  influencerROC:{ fontSize: 11, fontFamily: FONT.semibold },
  simpleRow:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  simpleLabel:{ flex: 1, fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  simpleValue:{ fontSize: 14, fontFamily: FONT.semibold, color: FG },
  emptyState:{ alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: FONT.semibold, color: FG },
  emptyBody:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 24 },
  });
};

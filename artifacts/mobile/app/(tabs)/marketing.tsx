import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '@/components/SectionHeader';
import { Badge } from '@/components/Badge';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';

const CAMPAIGNS = [
  { id: '1', name: 'Summer Drop 2025', type: 'Email', status: 'active', opens: '48%', revenue: '$2,840', sent: '4,200' },
  { id: '2', name: 'Flash Sale – 24hrs', type: 'SMS', status: 'scheduled', opens: '—', revenue: '—', sent: '—' },
  { id: '3', name: 'New Collection Teaser', type: 'Email', status: 'draft', opens: '—', revenue: '—', sent: '—' },
  { id: '4', name: 'Loyalty Reward Blast', type: 'Push', status: 'completed', opens: '62%', revenue: '$1,210', sent: '1,800' },
];

const DISCOUNTS = [
  { code: 'SUMMER20', type: '20% off', uses: 142, limit: 500, expires: 'Jul 31' },
  { code: 'FIRSTORDER', type: '$10 off', uses: 892, limit: null, expires: 'No expiry' },
  { code: 'VIP50', type: '50% off', uses: 28, limit: 100, expires: 'Jul 15' },
];

const SOCIAL_POSTS = [
  { day: 'Mon', platform: 'Instagram', text: 'New drop teaser', status: 'scheduled' },
  { day: 'Wed', platform: 'TikTok', text: 'Behind-the-scenes', status: 'scheduled' },
  { day: 'Fri', platform: 'Instagram', text: 'Product launch', status: 'draft' },
];

const AUTOMATIONS = [
  { name: 'Abandoned Cart Recovery', enabled: true, triggers: '3h after cart abandonment' },
  { name: 'Post-Purchase Review', enabled: true, triggers: '14 days after delivery' },
  { name: 'Win-Back Campaign', enabled: false, triggers: '60 days inactive' },
  { name: 'VIP Tier Upgrade', enabled: true, triggers: 'When spend > $500' },
];

type KlaviyoStatus = {
  connected: boolean;
  companyName?: string | null;
  emailSubscriberCount?: number;
  smsSubscriberCount?: number;
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function MarketingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [automations, setAutomations] = useState(AUTOMATIONS.map((a) => a.enabled));
  const [klaviyo, setKlaviyo] = useState<KlaviyoStatus | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api.integrations.klaviyoStatus()
        .then((res) => { if (!cancelled) setKlaviyo(res); })
        .catch(() => { if (!cancelled) setKlaviyo({ connected: false }); });
      return () => { cancelled = true; };
    }, [api]),
  );

  const statusVariant = (s: string) => {
    if (s === 'active') return 'success';
    if (s === 'scheduled') return 'info';
    if (s === 'completed') return 'default';
    return 'warning';
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Marketing</Text>
          <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Campaigns, discounts & automation</Text>
        </View>
      </View>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        {[
          { label: 'Email Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.emailSubscriberCount ?? 0) : '0', icon: 'mail' as const },
          { label: 'SMS Subs', value: klaviyo == null ? '—' : klaviyo.connected ? formatCount(klaviyo.smsSubscriberCount ?? 0) : '0', icon: 'message-square' as const },
          { label: 'Push Subs', value: '8.1k', icon: 'bell' as const },
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
      <SectionHeader title="Campaigns" action="New +" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {CAMPAIGNS.map((c, i) => (
          <View key={c.id} style={[styles.campaignRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.campaignIcon, { backgroundColor: c.type === 'Email' ? '#4A6FA522' : c.type === 'SMS' ? '#4C9A5E22' : '#00C85322' }]}>
              <Feather
                name={c.type === 'Email' ? 'mail' : c.type === 'SMS' ? 'message-square' : 'bell'}
                size={16}
                color={c.type === 'Email' ? colors.info : c.type === 'SMS' ? colors.success : colors.primary}
              />
            </View>
            <View style={styles.campaignInfo}>
              <Text style={[styles.campaignName, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
              <View style={styles.campaignMeta}>
                <Badge label={c.status} variant={statusVariant(c.status) as any} />
                {c.opens !== '—' && (
                  <Text style={[styles.campaignStat, { color: colors.mutedForeground }]}>↗ {c.opens} opens</Text>
                )}
              </View>
            </View>
            {c.revenue !== '—' && (
              <Text style={[styles.campaignRevenue, { color: colors.primary }]}>{c.revenue}</Text>
            )}
          </View>
        ))}
      </View>

      {/* Discount Codes */}
      <SectionHeader title="Discount Codes" action="New +" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {DISCOUNTS.map((d, i) => (
          <View key={d.code} style={[styles.discountRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.codeWrap, { backgroundColor: '#00C85322' }]}>
              <Text style={[styles.code, { color: colors.primary }]}>{d.code}</Text>
            </View>
            <View style={styles.discountInfo}>
              <Text style={[styles.discountType, { color: colors.foreground }]}>{d.type}</Text>
              <Text style={[styles.discountMeta, { color: colors.mutedForeground }]}>
                {d.uses} uses{d.limit != null ? ` / ${d.limit}` : ''} · {d.expires}
              </Text>
            </View>
            <Feather name="copy" size={15} color={colors.mutedForeground} />
          </View>
        ))}
      </View>

      {/* Social Calendar */}
      <SectionHeader title="Social Calendar" action="Add Post" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {SOCIAL_POSTS.map((p, i) => (
          <View key={`${p.day}-${i}`} style={[styles.postRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.dayBadge, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.dayText, { color: colors.mutedForeground }]}>{p.day}</Text>
            </View>
            <Feather name={p.platform === 'Instagram' ? 'instagram' : 'video'} size={16} color={colors.mutedForeground} />
            <View style={styles.postInfo}>
              <Text style={[styles.postText, { color: colors.foreground }]}>{p.text}</Text>
              <Text style={[styles.postPlatform, { color: colors.mutedForeground }]}>{p.platform}</Text>
            </View>
            <Badge label={p.status} variant={p.status === 'scheduled' ? 'info' : 'warning'} />
          </View>
        ))}
      </View>

      {/* Automations */}
      <SectionHeader title="Automations" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {AUTOMATIONS.map((a, i) => (
          <View key={a.name} style={[styles.autoRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={styles.autoInfo}>
              <Text style={[styles.autoName, { color: colors.foreground }]}>{a.name}</Text>
              <Text style={[styles.autoTrigger, { color: colors.mutedForeground }]}>{a.triggers}</Text>
            </View>
            <Switch
              value={automations[i]}
              onValueChange={(v) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setAutomations((prev) => prev.map((val, idx) => (idx === i ? v : val)));
              }}
              trackColor={{ false: colors.secondary, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        ))}
      </View>

      {/* Referral */}
      <SectionHeader title="Referral Program" />
      <View style={[styles.referralCard, { backgroundColor: '#17140F', borderColor: '#00C85344' }]}>
        <Feather name="share-2" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.referralTitle, { color: colors.foreground }]}>Earn $10 per referral</Text>
          <Text style={[styles.referralSub, { color: colors.mutedForeground }]}>124 active referrers · $3,240 earned total</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.primary} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  pageTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  statChip: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4 },
  statVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  klaviyoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14, marginBottom: 24 },
  klaviyoText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  campaignRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
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

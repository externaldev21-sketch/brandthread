/**
 * Paid Promotion Boost Tool
 * Route: /boost?targetType=post|product&targetId=<uuid>
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  ORANGE, RED, GOLD, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';

const BUDGETS = [
  { label: '$10',  cents: 1000  },
  { label: '$25',  cents: 2500  },
  { label: '$50',  cents: 5000  },
  { label: '$100', cents: 10000 },
  { label: '$250', cents: 25000 },
];
const DURATIONS = [
  { label: '3 days',  days: 3  },
  { label: '7 days',  days: 7  },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
];

type Boost = {
  id: string; status: string; budgetCents: number; spentCents: number;
  impressionsCount: number; durationDays: number; startsAt: string; endsAt: string;
  estimatedImpressions: number;
};

export default function BoostScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const api     = useApi();
  const { targetType, targetId } = useLocalSearchParams<{ targetType: string; targetId: string }>();

  const [selectedBudget,   setSelectedBudget]   = useState(BUDGETS[1]);    // $25 default
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[1]);  // 7d default
  const [launching,        setLaunching]         = useState(false);
  const [existing,         setExisting]          = useState<Boost[]>([]);
  const [loadingExisting,  setLoadingExisting]   = useState(true);

  const estimatedImpressions = Math.round(selectedBudget.cents * 0.4);

  useFocusEffect(useCallback(() => {
    if (!targetId) return;
    setLoadingExisting(true);
    (api as any).boosts?.list?.(targetId)
      .then((rows: Boost[]) => setExisting(rows ?? []))
      .catch(() => setExisting([]))
      .finally(() => setLoadingExisting(false));
  }, [api, targetId]));

  async function handleLaunch() {
    if (!targetType || !targetId) {
      Alert.alert('Error', 'Invalid boost target.'); return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLaunching(true);
    try {
      await (api as any).boosts?.create?.({
        targetType,
        targetId,
        budgetCents:  selectedBudget.cents,
        durationDays: selectedDuration.days,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        '🚀 Boost Launched!',
        `Your ${targetType} will get elevated placement for ${selectedDuration.label}. You'll see impressions grow in your analytics.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e: any) {
      const msg = e?.message ?? 'Could not launch boost.';
      if (msg.includes('card_declined')) {
        Alert.alert('Card Declined', 'Please update your payment method in Billing settings.');
      } else if (msg.includes('402')) {
        Alert.alert('Payment Required', 'Add a payment method in Billing before boosting.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setLaunching(false);
    }
  }

  function statusColor(s: string) {
    return s === 'active' ? SUCCESS : s === 'paused' ? ORANGE : MUTED;
  }
  function statusLabel(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Boost {targetType === 'post' ? 'Post' : 'Product'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}>

        {/* What is a boost */}
        <View style={s.infoBanner}>
          <Feather name="zap" size={16} color={GOLD} />
          <Text style={s.infoBannerText}>
            Boosted content is ranked higher in buyer feeds, reaching beyond your existing followers.
          </Text>
        </View>

        {/* Budget picker */}
        <Text style={s.sectionLabel}>BUDGET</Text>
        <View style={s.chipRow}>
          {BUDGETS.map(b => (
            <TouchableOpacity
              key={b.cents}
              style={[s.chip, selectedBudget.cents === b.cents && s.chipActive]}
              onPress={() => { Haptics.selectionAsync(); setSelectedBudget(b); }}
            >
              <Text style={[s.chipText, selectedBudget.cents === b.cents && s.chipTextActive]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Duration picker */}
        <Text style={s.sectionLabel}>DURATION</Text>
        <View style={s.chipRow}>
          {DURATIONS.map(d => (
            <TouchableOpacity
              key={d.days}
              style={[s.chip, selectedDuration.days === d.days && s.chipActive]}
              onPress={() => { Haptics.selectionAsync(); setSelectedDuration(d); }}
            >
              <Text style={[s.chipText, selectedDuration.days === d.days && s.chipTextActive]}>{d.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Estimated reach */}
        <View style={s.reachCard}>
          <View style={s.reachRow}>
            <Feather name="eye" size={18} color={PURPLE_LIGHT} />
            <View style={{ flex: 1 }}>
              <Text style={s.reachTitle}>Estimated Reach</Text>
              <Text style={s.reachValue}>~{estimatedImpressions.toLocaleString()} impressions</Text>
            </View>
          </View>
          <View style={s.divider} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={s.reachStat}>
              <Text style={s.reachStatLabel}>Total Charge</Text>
              <Text style={s.reachStatValue}>{selectedBudget.label}</Text>
            </View>
            <View style={s.reachStat}>
              <Text style={s.reachStatLabel}>Duration</Text>
              <Text style={s.reachStatValue}>{selectedDuration.label}</Text>
            </View>
            <View style={s.reachStat}>
              <Text style={s.reachStatLabel}>Per Day</Text>
              <Text style={s.reachStatValue}>${(selectedBudget.cents / selectedDuration.days / 100).toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Launch button */}
        <TouchableOpacity
          style={[s.launchBtn, launching && { opacity: 0.6 }]}
          onPress={handleLaunch}
          disabled={launching}
          activeOpacity={0.85}
        >
          {launching
            ? <ActivityIndicator color="#fff" />
            : <>
                <Feather name="zap" size={18} color="#fff" />
                <Text style={s.launchBtnText}>Launch Boost — Pay {selectedBudget.label}</Text>
              </>
          }
        </TouchableOpacity>

        <Text style={s.disclaimer}>
          Your stored payment method will be charged {selectedBudget.label}. Boosts can be paused from your Boost history.
        </Text>

        {/* Existing boosts */}
        {(loadingExisting ? true : existing.length > 0) && (
          <>
            <Text style={[s.sectionLabel, { marginTop: SP.xl }]}>BOOST HISTORY</Text>
            {loadingExisting
              ? <ActivityIndicator color={PURPLE} style={{ marginTop: SP.sm }} />
              : existing.map(b => (
                <View key={b.id} style={s.boostRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <View style={[s.statusDot, { backgroundColor: statusColor(b.status) }]} />
                      <Text style={s.boostStatus}>{statusLabel(b.status)}</Text>
                      <Text style={s.boostMeta}>{b.durationDays}d boost</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: SP.md }}>
                      <Text style={s.boostStat}><Text style={{ color: FG }}>{b.impressionsCount.toLocaleString()}</Text> impressions</Text>
                      <Text style={s.boostStat}><Text style={{ color: FG }}>${(b.spentCents / 100).toFixed(2)}</Text> / ${(b.budgetCents / 100).toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              ))
            }
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BG },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerBack:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  infoBanner:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#1A1505', borderWidth: 1, borderColor: '#4A3800', borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.lg },
  infoBannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: '#D97706', lineHeight: 18 },

  sectionLabel:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SP.sm, marginTop: SP.sm },
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SP.md },
  chip:          { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  chipActive:    { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  chipText:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive:{ color: PURPLE_LIGHT },

  reachCard:   { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md },
  reachRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SP.sm },
  reachTitle:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  reachValue:  { fontSize: FS.xl, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  divider:     { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  reachStat:   { alignItems: 'center' },
  reachStatLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  reachStatValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  launchBtn:      { backgroundColor: PURPLE, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginBottom: SP.sm },
  launchBtnText:  { fontSize: FS.base, fontFamily: FONT.bold, color: '#fff' },
  disclaimer:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 16, marginBottom: SP.xl },

  boostRow:   { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, padding: SP.md, marginBottom: SP.sm, flexDirection: 'row', alignItems: 'center' },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  boostStatus:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  boostMeta:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  boostStat:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

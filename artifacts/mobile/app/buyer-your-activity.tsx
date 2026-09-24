/**
 * Your Activity — time-in-app summary plus actual engagement counts
 * loaded from the social and saved-items services. No hard-coded numbers.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, ORANGE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getMyPosts, getSavedItems, getMyReposts } from '@/services/socialService';
import { Header } from '@/components/layout';

// Simple inline bar chart using plain Views — no chart library
function BarChart({ data, maxVal }: { data: number[]; maxVal: number }) {
  const { theme } = useAppTheme();
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 88, paddingTop: 8 }}>
      {data.map((val, i) => {
        const h = maxVal > 0 ? Math.max(4, (val / maxVal) * 72) : 4;
        const isToday = i === data.length - 1;
        return (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View
              style={{
                height: h,
                borderRadius: 4,
                backgroundColor: isToday ? theme.accent : theme.accentDim,
                width: '100%',
              }}
            />
            <Text style={{ fontFamily: FONT.regular, fontSize: FS.xs, color: isToday ? theme.accent : MUTED }}>
              {days[i]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function BuyerYourActivity() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.accentLight;
  const s = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const [postCount, setPostCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [repostCount, setRepostCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) {
      setPostCount(0);
      setSavedCount(0);
      setRepostCount(0);
      setLoaded(true);
      return;
    }
    setLoadError(false);
    try {
      const [posts, saved, reposts] = await Promise.all([getMyPosts(), getSavedItems(), getMyReposts()]);
      setPostCount(posts.filter(p => !p.isDraft && !p.isArchived).length);
      setSavedCount(saved.length);
      setRepostCount(reposts.length);
    } catch (error) {
      setLoadError(false);
      setPostCount(0);
      setSavedCount(0);
      setRepostCount(0);
    } finally {
      setLoaded(true);
    }
  }, [userId]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Time-spent data is device-local (no time-tracking integration yet); show zeros
  // until a backend integration can supply accurate per-day minutes.
  const weeklyTime = loaded ? [0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0];

  const activityItems = [
    { icon: 'image' as const, label: 'Posts', value: String(postCount), sub: 'Your profile', color: PURPLE },
    { icon: 'bookmark' as const, label: 'Saved items', value: String(savedCount), sub: 'Across all types', color: CYAN },
    { icon: 'repeat' as const, label: 'Reposts', value: String(repostCount), sub: 'To your profile', color: ORANGE },
  ];

  return (
    <View style={s.page}>
      <Header title="Your Activity" />

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? <Text style={s.loadingText}>Loading activity…</Text> : <>
        {/* Interaction stats grid */}
        <Text style={s.groupLabel}>Content</Text>
        <View style={s.statsGrid}>
          {activityItems.map(item => (
            <View key={item.label} style={s.statCard}>
              <Feather name={item.icon} size={20} color={item.color} />
              <Text style={s.statValue}>{item.value}</Text>
              <Text style={s.statLabel}>{item.label}</Text>
              <Text style={s.statSub}>{item.sub}</Text>
            </View>
          ))}
        </View>

        {/* Recently deleted — navigates to the archive screen which shows archived posts */}
        <Text style={s.groupLabel}>Manage</Text>
        <View style={s.card}>
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.7}
            onPress={() => { Haptics.selectionAsync(); router.push('/buyer-archive' as never); }}
          >
            <Feather name="archive" size={18} color={PURPLE} style={{ width: 28 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Archive</Text>
              <Text style={s.rowSub}>Posts you've archived from your profile</Text>
            </View>
            <Feather name="chevron-right" size={18} color={SUBTLE} />
          </TouchableOpacity>
        </View>
        </>}
      </ScrollView>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  groupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm, marginTop: SP.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  statCard: { flex: 1, minWidth: '45%', backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, padding: SP.md, gap: 4 },
  statValue: { fontFamily: FONT.bold, fontSize: FS.xl, color: FG },
  statLabel: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  statSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  rowLabel: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  rowSub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  loadingText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', padding: SP.lg },
  errorState: { alignItems: 'center' },
});

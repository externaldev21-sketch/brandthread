/**
 * Your Activity — time-in-app summary plus actual engagement counts
 * loaded from the social and saved-items services. No hard-coded numbers.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { getMyPosts, getSavedItems, getMyReposts } from '@/services/socialService';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ListRow } from '@/components/ui';
import { hapticToggle } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export default function BuyerYourActivity() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const [postCount, setPostCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [repostCount, setRepostCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) {
      setPostCount(0);
      setSavedCount(0);
      setRepostCount(0);
      setLoaded(true);
      return;
    }
    try {
      const [posts, saved, reposts] = await Promise.all([getMyPosts(), getSavedItems(), getMyReposts()]);
      setPostCount(posts.filter(p => !p.isDraft && !p.isArchived).length);
      setSavedCount(saved.length);
      setRepostCount(reposts.length);
    } catch (error) {
      setPostCount(0);
      setSavedCount(0);
      setRepostCount(0);
    } finally {
      setLoaded(true);
    }
  }, [userId]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const activityItems = [
    { icon: 'image' as const, label: 'Posts', value: String(postCount), sub: 'Your profile', color: theme.accent },
    { icon: 'bookmark' as const, label: 'Saved items', value: String(savedCount), sub: 'Across all types', color: theme.accentLight },
    { icon: 'repeat' as const, label: 'Reposts', value: String(repostCount), sub: 'To your profile', color: theme.secondary },
  ];

  return (
    <View style={s.page}>
      <ScreenHeader title="Your Activity" />

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? <Text style={s.loadingText}>Loading activity…</Text> : <>
        {/* Interaction stats grid */}
        <Text style={s.groupLabel}>Content</Text>
        <View style={s.statsGrid}>
          {activityItems.map(item => (
            <Card key={item.label} style={s.statCard}>
              <Feather name={item.icon} size={20} color={item.color} />
              <Text style={s.statValue}>{item.value}</Text>
              <Text style={s.statLabel}>{item.label}</Text>
              <Text style={s.statSub}>{item.sub}</Text>
            </Card>
          ))}
        </View>

        {/* Recently deleted — navigates to the archive screen which shows archived posts */}
        <Text style={s.groupLabel}>Manage</Text>
        <Card style={s.card}>
          <ListRow
            icon="archive"
            title="Archive"
            subtitle="Posts you've archived from your profile"
            chevron
            onPress={() => { hapticToggle(); router.push('/buyer-archive' as never); }}
          />
        </Card>
        </>}
      </ScrollView>
    </View>
  );
}

const makeStyles = (palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  groupLabel: { ...TYPE_SCALE.caption, color: palette.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.xs, marginTop: SPACING.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statCard: { flex: 1, minWidth: '45%', gap: 4 },
  statValue: { ...TYPE_SCALE.title2, color: palette.foreground },
  statLabel: { ...TYPE_SCALE.callout, color: palette.foreground },
  statSub: { ...TYPE_SCALE.caption, color: palette.mutedForeground },
  card: { padding: 0, overflow: 'hidden' },
  loadingText: { ...TYPE_SCALE.callout, color: palette.mutedForeground, textAlign: 'center', padding: SPACING.lg },
});

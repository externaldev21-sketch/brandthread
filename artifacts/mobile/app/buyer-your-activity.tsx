/**
 * Your Activity — time-in-app summary plus actual engagement counts
 * loaded from the social and saved-items services. No hard-coded numbers.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getMyPosts, getSavedItems, getMyReposts } from '@/services/socialService';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ErrorState, ListRow, SkeletonBlock, SkeletonLine } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

function StatsSkeleton({ s }: { s: Styles }) {
  return (
    <>
      <SkeletonLine width={72} height={12} style={{ marginBottom: SPACING.sm, marginTop: SPACING.md }} />
      <View style={s.statsGrid}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.statCard}>
            <SkeletonBlock width={20} height={20} radius={4} />
            <SkeletonLine width="40%" height={22} style={{ marginTop: SPACING.xs }} />
            <SkeletonLine width="60%" height={12} />
            <SkeletonLine width="80%" height={11} />
          </View>
        ))}
      </View>
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

export default function BuyerYourActivity() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
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
      setLoadError(false);
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
      // Don't show a false "0 across the board" empty state on a failed
      // fetch — surface a real error with a retry instead.
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [userId]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const activityItems = [
    { icon: 'image' as const, label: 'Posts', value: String(postCount), sub: 'Your profile', color: theme.accent },
    { icon: 'bookmark' as const, label: 'Saved items', value: String(savedCount), sub: 'Across all types', color: theme.accentLight },
    { icon: 'repeat' as const, label: 'Reposts', value: String(repostCount), sub: 'To your profile', color: theme.warning },
  ];

  return (
    <View style={s.page}>
      <ScreenHeader title="Your Activity" />

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + SPACING.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <StatsSkeleton s={s} />
        ) : loadError ? (
          <ErrorState
            message="Couldn't load your activity. Check your connection and try again."
            onRetry={() => { setLoaded(false); void loadData(); }}
          />
        ) : (
          <>
            {/* Interaction stats grid */}
            <Text style={s.groupLabel}>Content</Text>
            <View style={s.statsGrid}>
              {activityItems.map(item => (
                <Card key={item.label} style={s.statCard}>
                  <Feather name={item.icon} size={ICON.md} color={item.color} />
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
                iconColor={theme.accent}
                title="Archive"
                subtitle="Posts you've archived from your profile"
                chevron
                onPress={() => router.push('/buyer-archive' as never)}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  groupLabel: {
    ...TYPE_SCALE.caption,
    fontFamily: FONT.semibold,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  statCard: { flex: 1, minWidth: '45%', gap: 4 },
  statValue: { ...TYPE_SCALE.title2, color: theme.text },
  statLabel: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: theme.text },
  statSub: { ...TYPE_SCALE.caption, color: theme.muted },
  card: { paddingVertical: SPACING.xxs, paddingHorizontal: SPACING.md, overflow: 'hidden' },
});

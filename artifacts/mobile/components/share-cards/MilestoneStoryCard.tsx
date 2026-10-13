/**
 * MilestoneStoryCard: the 9:16 image a seller shares to Instagram Stories
 * when they hit a milestone. Hevy's "This is your 1st workout" share card,
 * Brandthread-style: plain type on black, the real product photo, the store
 * name and handle. No confetti, no gradient.
 *
 * Laid out at 360x640 dp and captured at 1080x1920 by captureShareCard
 * (lib/shareCard.ts). Colors come from the seller's Appearance theme, like
 * the other share cards, so the default theme gives white type on black.
 */
import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatReachedDate, type SellerMilestone } from '@/lib/milestones';
import { FONT } from '@/lib/theme';

export const STORY_LAYOUT_WIDTH = 360;
export const STORY_LAYOUT_HEIGHT = 640;

export const MilestoneStoryCard = React.forwardRef<View, { milestone: SellerMilestone; theme: AppThemePreset }>(
  function MilestoneStoryCard({ milestone, theme }, ref) {
    const styles = useMemo(() => createStyles(theme), [theme]);
    const photo = milestone.productImageUrl;
    return (
      <View ref={ref} collapsable={false} style={styles.root} testID="milestone-story-card">
        <View style={styles.head}>
          <Text style={styles.store} numberOfLines={1}>{milestone.storeName}</Text>
          <Text style={[styles.label, !photo && styles.labelTypeOnly]} numberOfLines={2}>{milestone.label}</Text>
          <Text style={styles.date}>{formatReachedDate(milestone.reachedAt)}</Text>
        </View>

        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.spacer} />
        )}

        <View style={styles.foot}>
          <Text style={styles.wordmark}>BRANDTHREAD</Text>
          {milestone.handle ? <Text style={styles.handle} numberOfLines={1}>@{milestone.handle}</Text> : null}
        </View>
      </View>
    );
  },
);

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: {
    width: STORY_LAYOUT_WIDTH,
    height: STORY_LAYOUT_HEIGHT,
    backgroundColor: theme.background,
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 32,
  },
  head: { gap: 6 },
  store: { fontFamily: FONT.semibold, fontSize: 15, color: theme.text },
  label: { fontFamily: FONT.bold, fontSize: 38, lineHeight: 42, letterSpacing: -1, color: theme.text },
  labelTypeOnly: { fontSize: 52, lineHeight: 56 },
  date: { fontFamily: FONT.regular, fontSize: 14, color: theme.muted },
  photo: {
    flex: 1,
    marginTop: 28,
    marginBottom: 24,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  spacer: { flex: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wordmark: { fontFamily: FONT.bold, fontSize: 11, letterSpacing: 2, color: theme.text },
  handle: { flexShrink: 1, fontFamily: FONT.medium, fontSize: 13, color: theme.muted },
});

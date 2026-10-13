/**
 * MilestoneCard: a compact version of the milestone story card for the
 * dashboard's top slot. One tap on "Share to Stories" renders the 1080x1920
 * story image offscreen, captures it and hands it to Instagram Stories (the
 * system share sheet when Instagram isn't there; a PNG download on web).
 * Sharing or X marks the milestone seen, so the card never comes back.
 * One success haptic on a completed share; no confetti, no count-up.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PressableScale } from '@/components/BrandthreadUI';
import { MilestoneStoryCard } from '@/components/share-cards/MilestoneStoryCard';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticSuccess } from '@/lib/haptics';
import { formatReachedDate, type SellerMilestone } from '@/lib/milestones';
import { captureShareCard, shareCardToInstagramStories, triggerWebImageDownload } from '@/lib/shareCard';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

export default function MilestoneCard({
  milestone,
  theme,
  onDone,
}: {
  milestone: SellerMilestone;
  theme: AppThemePreset;
  /** Shared or closed: mark seen and hide. */
  onDone: () => void;
}) {
  const s = useMemo(() => createStyles(theme), [theme]);
  const storyRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    let completed = false;
    try {
      const uri = await captureShareCard(storyRef);
      if (Platform.OS === 'web') {
        triggerWebImageDownload(uri, `brandthread-${milestone.key}.png`);
        completed = true;
      } else {
        completed = (await shareCardToInstagramStories(uri)) !== 'cancelled';
      }
    } catch {
      completed = false;
    } finally {
      setSharing(false);
    }
    if (completed) {
      hapticSuccess();
      onDone();
    }
  };

  return (
    <View style={s.card} testID="milestone-card">
      <View style={s.row}>
        {milestone.productImageUrl ? (
          <Image source={{ uri: milestone.productImageUrl }} style={s.thumb} resizeMode="cover" />
        ) : null}
        <View style={s.copy}>
          <Text style={s.label} numberOfLines={2}>{milestone.label}</Text>
          <Text style={s.meta} numberOfLines={1}>
            {milestone.storeName} · {formatReachedDate(milestone.reachedAt)}
          </Text>
        </View>
        <PressableScale onPress={onDone} accessibilityLabel="Close" hitSlop={8} noMinHeight style={s.close} testID="milestone-dismiss">
          <Feather name="x" size={15} color={theme.muted} />
        </PressableScale>
      </View>

      <PressableScale
        onPress={() => { void share(); }}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel="Share to Instagram Stories"
        style={s.action}
        testID="milestone-share"
      >
        {sharing
          ? <ActivityIndicator size="small" color={theme.onAccent} />
          : <Text style={s.actionText}>Share to Stories</Text>}
      </PressableScale>

      {/* The story image, laid out offscreen and captured only on share. */}
      <View style={s.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MilestoneStoryCard ref={storyRef} milestone={milestone} theme={theme} />
      </View>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: SP.md,
    gap: SP.md,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md },
  thumb: { width: 64, height: 80, borderRadius: RADIUS.sm, backgroundColor: theme.border },
  copy: { flex: 1, minWidth: 0, gap: 4, paddingTop: 2 },
  label: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text, letterSpacing: -0.3 },
  meta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    minHeight: 46,
    borderRadius: RADIUS.pill,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.md,
  },
  actionText: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.onAccent },
  offscreen: { position: 'absolute', left: -10000, top: 0 },
});

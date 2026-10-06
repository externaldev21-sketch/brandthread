import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { groupMentionRings, ringLabel, type MentionRing } from '@/lib/storyMentionsRail';
import type { StoryMentionItem } from '@/services/socialTypes';

const RING_SIZE = 64;
const RING_WIDTH = 2.5;
const ITEM_MAX_WIDTH = 104;

function MentionRingAvatar({ ring, styles, theme }: { ring: MentionRing; styles: ReturnType<typeof makeStyles>; theme: AppThemePreset }) {
  const inner = RING_SIZE - RING_WIDTH * 2 - 4;
  const { tagger } = ring;
  return (
    <View
      style={[
        styles.ring,
        // White = something unseen; dim silver once every story is viewed.
        { borderColor: ring.seen ? theme.border : theme.text },
      ]}
    >
      <View style={[styles.avatar, { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }]}>
        {tagger.avatarUrl ? (
          <CachedImage source={{ uri: tagger.avatarUrl }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
        ) : (
          <Text style={styles.initials} allowFontScaling={false}>{tagger.initials}</Text>
        )}
      </View>
      {ring.storyIds.length > 1 ? (
        <View style={styles.countBadge} pointerEvents="none">
          <Text style={styles.countText} allowFontScaling={false}>{ring.storyIds.length}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * "Story mentions" rail at the top of Activity: one ring per person who
 * tagged me in a story (white = unseen, dim silver = seen), newest first.
 * Renders nothing when there are no mentions.
 */
export default function StoryMentionsRail({ items, onOpen, onSeeAll }: {
  items: readonly StoryMentionItem[];
  /** Open the viewer at this story id. */
  onOpen: (storyId: string) => void;
  onSeeAll: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const rings = useMemo(() => groupMentionRings(items), [items]);
  if (rings.length === 0) return null;

  return (
    <View style={styles.wrap} testID="story-mentions-rail">
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>Story mentions</Text>
        <Pressable
          onPress={onSeeAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="See all story mentions"
          testID="story-mentions-see-all"
        >
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {rings.map((ring) => {
          const label = ringLabel(ring.tagger);
          return (
            <PressableScale
              key={ring.key}
              style={styles.item}
              onPress={() => onOpen(ring.startStoryId)}
              accessibilityRole="button"
              accessibilityLabel={`${label} mentioned you in a story, ${ring.seen ? 'seen' : 'new'}`}
              testID={`story-mention-ring-${ring.key}`}
              noMinHeight
            >
              <MentionRingAvatar ring={ring} styles={styles} theme={theme} />
              <Text style={[styles.label, !ring.seen && styles.labelUnseen]} numberOfLines={1} ellipsizeMode="tail">
                {label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  wrap: { paddingTop: SP.xs, paddingBottom: SP.sm },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  title: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.md, letterSpacing: -0.2 },
  seeAll: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm },
  // flexGrow: when the rings fit on screen, the spare width is shared out
  // between them (up to ITEM_MAX_WIDTH each) so handles use it instead of
  // truncating next to empty space; when they don't fit, each ring keeps its
  // base width and the row scrolls as before.
  scroll: { paddingHorizontal: SP.md, gap: SP.md, flexGrow: 1 },
  item: { flexGrow: 1, flexBasis: RING_SIZE + 8, minWidth: RING_SIZE + 8, maxWidth: ITEM_MAX_WIDTH, alignItems: 'center' },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  countBadge: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.background,
    backgroundColor: theme.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: theme.background, fontFamily: FONT.bold, fontSize: 10 },
  label: { marginTop: SP.xs + 2, maxWidth: '100%', color: theme.muted, fontFamily: FONT.medium, fontSize: FS.meta },
  labelUnseen: { color: theme.text },
});

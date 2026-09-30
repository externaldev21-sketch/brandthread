/**
 * Story mentions — "See all" from the Activity rail: every live (<24h) story
 * that tagged me, newest first. A row opens the tap-through viewer at that
 * story (app/story-mention-viewer.tsx). Reshared / dismissed ones carry a
 * quiet tag; an unseen one has a white dot and a bold sentence.
 */
import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { EmptyState, SkeletonBlock, useScreenPadding } from '@/components/layout';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale } from '@/components/BrandthreadUI';
import { useStoryMentions } from '@/hooks/useStoryMentions';
import { relativeTime } from '@/lib/activity';
import { atHandle, handledLabel, orderMentions, storyMentionViewerHref } from '@/lib/storyMentionsRail';
import type { StoryMentionItem } from '@/services/socialTypes';

const AVATAR = 44;

const MentionRow = React.memo(function MentionRow({ item, now, styles, onOpen }: {
  item: StoryMentionItem;
  now: number;
  styles: Styles;
  onOpen: (storyId: string) => void;
}) {
  const { tagger } = item;
  const tag = handledLabel(item);
  const handle = atHandle(tagger.handle) || tagger.name;
  return (
    <PressableScale
      style={styles.row}
      onPress={() => onOpen(item.storyId)}
      accessibilityRole="button"
      accessibilityLabel={`${handle} mentioned you in their story${item.seen ? '' : ', new'}`}
      testID={`story-mention-row-${item.storyId}`}
      noMinHeight
    >
      <View style={styles.dotSlot}>{!item.seen ? <View style={styles.dot} /> : null}</View>
      <View style={[styles.avatar, { backgroundColor: '#1C1C1E' }]}>
        {tagger.avatarUrl ? (
          <CachedImage source={{ uri: tagger.avatarUrl }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
        ) : (
          <Text style={styles.initials} allowFontScaling={false}>{tagger.initials}</Text>
        )}
      </View>
      <View style={styles.text}>
        <Text style={[styles.sentence, item.seen ? styles.sentenceSeen : styles.sentenceUnseen]} numberOfLines={2}>
          <Text style={styles.name}>{handle}</Text>
          {' mentioned you in their story'}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{relativeTime(item.mentionedAt, now)}</Text>
          {tag ? <Text style={styles.tag}>{tag}</Text> : null}
        </View>
      </View>
      {item.thumbnailUrl ? (
        <CachedImage source={{ uri: item.thumbnailUrl }} style={styles.thumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.thumb} />
      )}
    </PressableScale>
  );
});

export default function StoryMentionsScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const screenPadding = useScreenPadding({ withTabBarInset: false });
  const router = useRouter();
  const { items, loading } = useStoryMentions();
  const ordered = useMemo(() => orderMentions(items), [items]);
  const now = useMemo(() => Date.now(), [items]);

  const open = useCallback((storyId: string) => {
    router.push(storyMentionViewerHref(storyId) as never);
  }, [router]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Story mentions" />
      {loading ? (
        <View style={styles.skeletonWrap} accessibilityLabel="Loading story mentions">
          {Array.from({ length: 6 }).map((_, index) => (
            <View key={index} style={styles.skeletonRow}>
              <SkeletonBlock width={AVATAR} height={AVATAR} radius={AVATAR / 2} />
              <View style={styles.text}>
                <SkeletonBlock width={index % 2 ? '70%' : '84%'} height={13} />
                <SkeletonBlock width={index % 3 ? '24%' : '32%'} height={11} />
              </View>
              <SkeletonBlock width={44} height={56} radius={8} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.storyId}
          renderItem={({ item }) => <MentionRow item={item} now={now} styles={styles} onOpen={open} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            { paddingBottom: screenPadding.bottom + SP.xl },
            ordered.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              <EmptyState
                icon="at-sign"
                title="No story mentions"
                message="When someone mentions you in their story, it shows up here for 24 hours."
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm + 2,
    paddingVertical: SP.sm,
    paddingRight: SP.md,
    paddingLeft: SP.xs,
  },
  dotSlot: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.text },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  initials: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
  text: { flex: 1, gap: SP.xs },
  sentence: { fontSize: FS.base, lineHeight: 20 },
  sentenceUnseen: { color: theme.text, fontFamily: FONT.semibold },
  sentenceSeen: { color: theme.muted, fontFamily: FONT.regular },
  name: { fontFamily: FONT.bold, color: theme.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  meta: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.meta },
  tag: {
    color: theme.muted,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  thumb: { width: 44, height: 56, borderRadius: 8, backgroundColor: theme.border },
  listEmpty: { flexGrow: 1 },
  stateWrap: { flex: 1, justifyContent: 'center', paddingBottom: SP.xxl },
  skeletonWrap: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs + 2 },
});

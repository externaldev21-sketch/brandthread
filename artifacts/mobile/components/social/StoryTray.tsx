import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { CachedImage } from '@/components/CachedImage';
import { useApi } from '@/lib/api';

export type StoryTrayEntry = {
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  authorAccountType: string;
  isMe: boolean;
  storyIds: string[];
  seen: boolean;
};

const RING_SIZE = 64;

/**
 * A single story ring: theme-accent when unseen, grey when every story from
 * that author has been viewed. Reusable standalone on a profile avatar or
 * inside the horizontal StoryTray below.
 */
export function StoryRing({
  size = RING_SIZE,
  seen,
  color,
  avatarUrl,
  initials,
  onPress,
  showPlusBadge,
  testID,
}: {
  size?: number;
  seen: boolean;
  color: string;
  avatarUrl?: string | null;
  initials: string;
  onPress?: () => void;
  showPlusBadge?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const ringWidth = 2.5;
  const inner = size - ringWidth * 2 - 4;

  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.8}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={showPlusBadge ? 'Your story' : `${initials}'s story, ${seen ? 'seen' : 'unseen'}`}
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringWidth,
          borderColor: seen ? theme.border : theme.accent,
        },
      ]}
    >
      <View
        style={[
          styles.avatar,
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: color },
        ]}
      >
        {avatarUrl ? (
          <CachedImage source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.initials}>{initials}</Text>
        )}
      </View>
      {showPlusBadge && (
        <View style={[styles.plusBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
          <Feather name="plus" size={11} color={theme.onAccent} />
        </View>
      )}
    </TouchableOpacity>
  );
}

type Props = {
  myAvatarUrl?: string | null;
  myInitials: string;
  onCreateStory: () => void;
  onOpenAuthor: (entry: StoryTrayEntry) => void;
  /** Refetch every time the screen regains focus (default true). */
  refetchOnFocus?: boolean;
};

/**
 * Horizontal stories tray for the feed's Following tab and profile screens:
 * "your story" first (with a create + badge), then everyone you follow with
 * an active story, unseen rings first.
 */
export default function StoryTray({ myAvatarUrl, myInitials, onCreateStory, onOpenAuthor, refetchOnFocus = true }: Props) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [entries, setEntries] = useState<StoryTrayEntry[]>([]);
  const styles2 = React.useMemo(() => makeStyles(theme), [theme]);

  const load = useCallback(async () => {
    try {
      const rows = await api.social.storiesFollowing();
      setEntries(rows.filter((r) => !r.isMe));
    } catch {
      // Tray degrades to just the "your story" entry if the request fails.
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { if (refetchOnFocus) load(); }, [load, refetchOnFocus]));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles2.scroll}
      testID="story-tray"
    >
      <View style={styles2.item}>
        <StoryRing
          testID="story-tray-create"
          seen
          color={theme.cardElevated}
          avatarUrl={myAvatarUrl}
          initials={myInitials}
          showPlusBadge
          onPress={onCreateStory}
        />
        <Text style={styles2.label} numberOfLines={1}>Your story</Text>
      </View>
      {entries.map((entry) => (
        <View key={entry.authorId} style={styles2.item}>
          <StoryRing
            testID={`story-tray-${entry.authorId}`}
            seen={entry.seen}
            color={entry.authorColor}
            initials={entry.authorInitials}
            onPress={() => onOpenAuthor(entry)}
          />
          <Text style={styles2.label} numberOfLines={1}>{entry.authorName.split(' ')[0]}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.sm },
  plusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  scroll: { paddingHorizontal: SP.md, gap: SP.md, paddingVertical: SP.sm },
  item: { alignItems: 'center', width: RING_SIZE + 12 },
  label: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 4 },
});

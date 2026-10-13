/**
 * Discover's People tab row, after Pinterest's people list
 * (https://mobbin.com/screens/135d3c41-3786-4492-aaea-c907ec5f0a36):
 * 48pt avatar, name, @handle, and a mutuals line only when the suggestion
 * carries real mutual-follow data (lib/discoverFormat.ts mutualsLine) —
 * otherwise the line is left out. Follow sits on the right.
 *
 * Two SIBLING tap targets, never nested (see
 * tests/discover-no-nested-pressables.test.ts): the row body opens the
 * profile, FollowButton follows.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import FollowButton from '@/components/social/FollowButton';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { mutualsLine } from '@/lib/discoverFormat';
import type { DiscoverPersonSuggestion } from '@/lib/discoverFeed';

const AVATAR = 48;

export function DiscoverPersonCard({ person }: { person: DiscoverPersonSuggestion }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const mutuals = mutualsLine(person);
  return (
    <View style={styles.row} testID={`discover-person-row-${person.userId}`}>
      {/* PressableScale's own wrapper doesn't take flex from `style`, so the
          growing column is this View — it keeps Follow pinned right. */}
      <View style={styles.grow}>
        <PressableScale
          onPress={() => router.push(`/buyer-other-profile?userId=${encodeURIComponent(person.userId)}&name=${encodeURIComponent(person.name)}&handle=${encodeURIComponent(person.handle)}&initials=${encodeURIComponent(person.initials)}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`${person.name}, ${person.handle}${mutuals ? `, ${mutuals}` : ''}`}
          style={styles.tapArea}
        >
          {person.avatarUrl ? (
            <CachedImage source={{ uri: person.avatarUrl }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.borderSubtle }]}>
              <Text style={[styles.initials, { color: theme.text }]}>{person.initials}</Text>
            </View>
          )}
          <View style={styles.text}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{person.name}</Text>
            <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{person.handle}</Text>
            {!!mutuals && (
              <Text style={[styles.mutuals, { color: theme.muted }]} numberOfLines={1}>{mutuals}</Text>
            )}
          </View>
        </PressableScale>
      </View>
      <FollowButton
        userId={person.userId}
        initial={{ isFollowing: person.isFollowing, isFollowedBy: false, isMutual: false }}
        size="compact"
        style={styles.follow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  grow: { flex: 1, minWidth: 0 },
  tapArea: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FONT.bold, fontSize: 17 },
  text: { flex: 1, minWidth: 0 },
  name: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20 },
  handle: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18 },
  mutuals: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, marginTop: 1 },
  follow: { minWidth: 96 },
});

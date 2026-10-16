/**
 * "People with your style" — a horizontal row of suggested buyers, inserted
 * every ~20 tiles into the For You grid (and reused, one per row, for the
 * People filter's full list). Follow is real: components/social/FollowButton
 * wired to api.social.follow/unfollow.
 */
import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { CachedImage as Image } from '@/components/CachedImage';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_HAIRLINE, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';
import FollowButton from '@/components/social/FollowButton';
import type { DiscoverPersonSuggestion } from '@/lib/discoverFeed';

function PersonAvatar({ person, size }: { person: DiscoverPersonSuggestion; size: number }) {
  if (person.avatarUrl) {
    return <Image cachePolicy="memory-disk" source={{ uri: person.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: person.color }]}>
      <Text style={styles.avatarInitials}>{person.initials}</Text>
    </View>
  );
}

export function DiscoverPeopleRow({ people }: { people: DiscoverPersonSuggestion[] }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  if (people.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="People with your style" />
      <FlatList
        horizontal
        data={people}
        keyExtractor={(p) => p.userId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: X_SPACE[12], paddingHorizontal: X_GUTTER }}
        renderItem={({ item }) => (
          // Two SIBLING tap targets, never nested: the card's own
          // PressableScale opens the profile; FollowButton is a plain
          // sibling View, not wrapped inside it — a Pressable inside a
          // Pressable renders as a nested <button> on web (invalid HTML,
          // and the two press handlers fight each other). See
          // tests/discover-no-nested-pressables.test.ts.
          <View style={[styles.card, { borderColor: xColors(theme).divider, backgroundColor: theme.card }]}>
            <PressableScale
              onPress={() => router.push(`/buyer-other-profile?userId=${encodeURIComponent(item.userId)}&name=${encodeURIComponent(item.name)}&handle=${encodeURIComponent(item.handle)}&initials=${encodeURIComponent(item.initials)}` as never)}
              style={styles.cardTapArea}
            >
              <PersonAvatar person={item} size={56} />
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.handle, { color: xColors(theme).secondary }]} numberOfLines={1}>{item.handle}</Text>
              <Text style={[styles.reason, { color: xColors(theme).secondary }]} numberOfLines={2}>{item.reason}</Text>
            </PressableScale>
            <FollowButton
              userId={item.userId}
              initial={{ isFollowing: item.isFollowing, isFollowedBy: false, isMutual: false }}
              size="compact"
              style={{ marginTop: SP.xs, alignSelf: 'stretch' }}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: X_SPACE[8] },
  card: {
    width: 130, borderRadius: RADII.card, borderWidth: X_HAIRLINE,
    paddingHorizontal: X_SPACE[12], paddingVertical: X_SPACE[16], alignItems: 'center', gap: X_SPACE[4],
  },
  cardTapArea: { alignItems: 'center', width: '100%' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.md },
  name: { ...X_TYPE.name, marginTop: X_SPACE[8], textAlign: 'center' },
  handle: { ...X_TYPE.meta, textAlign: 'center' },
  reason: { ...X_TYPE.meta, textAlign: 'center', marginTop: 2, minHeight: 32 },
});

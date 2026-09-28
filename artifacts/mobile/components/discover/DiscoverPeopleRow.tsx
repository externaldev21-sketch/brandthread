/**
 * "People with your style" — a horizontal row of suggested buyers, inserted
 * every ~20 tiles into the For You grid (and reused, one per row, for the
 * People filter's full list). Follow is real: components/social/FollowButton
 * wired to api.social.follow/unfollow.
 */
import React from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TYPE_SCALE } from '@/constants/typography';
import FollowButton from '@/components/social/FollowButton';
import type { DiscoverPersonSuggestion } from '@/lib/discoverFeed';

function PersonAvatar({ person, size }: { person: DiscoverPersonSuggestion; size: number }) {
  if (person.avatarUrl) {
    return <Image source={{ uri: person.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
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
      <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: SP.sm, marginHorizontal: SP.md }]}>
        People with your style
      </Text>
      <FlatList
        horizontal
        data={people}
        keyExtractor={(p) => p.userId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: SP.md }}
        renderItem={({ item }) => (
          <PressableScale
            onPress={() => router.push(`/buyer-other-profile?userId=${encodeURIComponent(item.userId)}&name=${encodeURIComponent(item.name)}&handle=${encodeURIComponent(item.handle)}&initials=${encodeURIComponent(item.initials)}` as never)}
            style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}
          >
            <PersonAvatar person={item} size={56} />
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{item.handle}</Text>
            <Text style={[styles.reason, { color: theme.muted }]} numberOfLines={2}>{item.reason}</Text>
            <FollowButton
              userId={item.userId}
              initial={{ isFollowing: item.isFollowing, isFollowedBy: false, isMutual: false }}
              size="compact"
              style={{ marginTop: SP.xs, alignSelf: 'stretch' }}
            />
          </PressableScale>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: SP.md },
  card: {
    width: 130, borderRadius: RADII.card, borderWidth: 1,
    paddingHorizontal: SP.sm, paddingVertical: SP.md, alignItems: 'center', gap: 4,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: FS.md },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 6, textAlign: 'center' },
  handle: { fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center' },
  reason: { fontFamily: FONT.regular, fontSize: 11, textAlign: 'center', marginTop: 2, minHeight: 28 },
});

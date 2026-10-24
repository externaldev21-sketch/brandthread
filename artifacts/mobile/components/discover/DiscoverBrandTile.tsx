/**
 * Discover's Brands tab tile — a profile card after Pinterest's profile
 * card (https://mobbin.com/screens/8dec4b4e-d0f8-4520-a3d6-2319e9d6ee9a):
 * banner strip across the top, the brand's avatar overlapping it, name
 * (+ verified check), follower count, Follow. The follower line only shows
 * a real count (the "N followers" label the API side builds); other labels
 * ("Following", "Featured") are not counts and are left off.
 *
 * Two SIBLING tap targets, never nested (see
 * tests/discover-no-nested-pressables.test.ts): the card body opens the
 * brand, FollowButton follows.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import FollowButton from '@/components/social/FollowButton';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { initialsOf } from '@/lib/discoveryShelves';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const BANNER_HEIGHT = 64;
const AVATAR = 48;
const AVATAR_RING = 3;

export function DiscoverBrandTile({ brand }: { brand: BrandCardData }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const followers = brand.followersLabel && /follower/i.test(brand.followersLabel) ? brand.followersLabel : null;
  const isFollowing = brand.followersLabel === 'Following';
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]} testID={`discover-brand-tile-${brand.id}`}>
      <PressableScale
        onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(brand.id)}&src=feed` as never)}
        accessibilityRole="button"
        accessibilityLabel={`${brand.name}${followers ? `, ${followers}` : ''}`}
        style={styles.tapArea}
      >
        <View style={[styles.banner, { backgroundColor: theme.borderSubtle }]}>
          {!!brand.imageUri && (
            <CachedImage source={{ uri: brand.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          )}
        </View>
        <View style={[styles.avatar, { backgroundColor: theme.borderSubtle, borderColor: theme.card }]}>
          <Text style={[styles.initials, { color: theme.text }]}>{initialsOf(brand.name)}</Text>
        </View>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
          {brand.verified && <Feather name="check-circle" size={13} color={theme.text} />}
        </View>
        {/* Reserve the line so every tile in a row stays the same height. */}
        <Text style={[styles.followers, TABULAR_NUMS, { color: theme.muted }]} numberOfLines={1}>{followers ?? ' '}</Text>
      </PressableScale>
      <FollowButton
        userId={brand.id}
        name={brand.name}
        initial={{ isFollowing, isFollowedBy: false, isMutual: false }}
        size="compact"
        style={styles.follow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, overflow: 'hidden', borderRadius: RADII.card, borderWidth: 1, paddingBottom: SP.sm },
  tapArea: { alignItems: 'center', width: '100%' },
  banner: { width: '100%', height: BANNER_HEIGHT, overflow: 'hidden' },
  avatar: {
    width: AVATAR + AVATAR_RING * 2, height: AVATAR + AVATAR_RING * 2, borderRadius: (AVATAR + AVATAR_RING * 2) / 2,
    borderWidth: AVATAR_RING, marginTop: -(AVATAR / 2 + AVATAR_RING), alignItems: 'center', justifyContent: 'center',
  },
  initials: { fontFamily: FONT.bold, fontSize: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6, paddingHorizontal: SP.sm, maxWidth: '100%' },
  name: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, flexShrink: 1, minWidth: 0 },
  followers: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, marginTop: 2, paddingHorizontal: SP.sm },
  follow: { marginTop: SP.sm, marginHorizontal: SP.sm, alignSelf: 'stretch' },
});

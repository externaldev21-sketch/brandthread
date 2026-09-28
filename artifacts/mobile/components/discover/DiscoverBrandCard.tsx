import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import FollowButton from '@/components/social/FollowButton';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

export function DiscoverBrandCard({ brand }: { brand: BrandCardData }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={() => router.push(`/seller-profile?id=${encodeURIComponent(brand.id)}` as never)}
      style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}
    >
      {brand.imageUri ? (
        <CachedImage source={{ uri: brand.imageUri }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.fallback]}>
          <Feather name="shopping-bag" size={22} color={theme.muted} />
        </View>
      )}
      <View style={styles.nameRow}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{brand.name}</Text>
        {brand.verified && <Feather name="check-circle" size={14} color={ON_DARK} />}
      </View>
      {!!brand.followersLabel && (
        <Text style={[styles.followers, { color: theme.muted }]} numberOfLines={1}>{brand.followersLabel}</Text>
      )}
      <FollowButton
        userId={brand.id}
        initial={{ isFollowing: false, isFollowedBy: false, isMutual: false }}
        size="compact"
        style={{ marginTop: SP.xs, alignSelf: 'stretch' }}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: RADII.card, borderWidth: 1, padding: SP.sm, alignItems: 'center', gap: 4 },
  image: { width: 64, height: 64, borderRadius: 32 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  followers: { fontFamily: FONT.regular, fontSize: FS.xs },
});

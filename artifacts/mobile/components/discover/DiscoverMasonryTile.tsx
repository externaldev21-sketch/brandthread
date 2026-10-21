/**
 * One For You masonry tile, copied from Pinterest's home feed pin
 * (https://mobbin.com/screens/14800a84-8bc1-476f-960a-b7353780defb):
 * rounded photo at its own aspect ratio, then a single line under it — here
 * a 20pt brand avatar + brand name. Commerce on top of the photo stays
 * small: the tagged product's price bottom-left on a subtle shade, and for
 * video a play glyph + duration top-right (duration only when known).
 * Tap opens the post viewer; long-press the safety menu (unchanged).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/layout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { formatCents } from '@/lib/money';
import { formatVideoDuration } from '@/lib/discoverFormat';
import type { DiscoverPost } from '@/lib/discoverFeed';

export const MASONRY_AVATAR = 20;
/** Image-to-caption spacing + caption line height — used by the column balancer. */
export const MASONRY_CAPTION_HEIGHT = 6 + MASONRY_AVATAR;

const ON_PHOTO = '#FFFFFF';
const PHOTO_SHADE = 'rgba(0,0,0,0.45)';

export function DiscoverMasonryTile({
  post, width, imageHeight, onPress, onLongPress, showCreator = true,
}: {
  post: DiscoverPost;
  width: number;
  imageHeight: number;
  onPress: () => void;
  onLongPress: () => void;
  showCreator?: boolean;
}) {
  const { theme } = useAppTheme();
  const price = post.productTags?.[0]?.priceCents;
  const duration = post.media === 'video' ? formatVideoDuration(post.durationSec) : null;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${post.authorName}${post.caption ? `: ${post.caption}` : ''}${price != null ? `, ${formatCents(price)}` : ''}`}
      testID={`discover-tile-${post.id}`}
      style={{ width }}
    >
      <View style={[styles.imageWrap, { height: imageHeight, backgroundColor: theme.borderSubtle }]}>
        {post.imageUri ? (
          <CachedImage source={{ uri: post.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          // Same text-card fallback as the Explore grid for posts the API
          // sends without an image.
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            <Text style={[styles.fallbackInitials, { color: theme.muted }]}>{post.authorInitials}</Text>
            {!!post.caption && (
              <Text style={[styles.fallbackCaption, { color: theme.muted }]} numberOfLines={4}>{post.caption}</Text>
            )}
          </View>
        )}
        {post.media === 'video' && (
          <View style={[styles.topRight, styles.chip]} testID={`discover-tile-video-${post.id}`}>
            <Feather name="play" size={11} color={ON_PHOTO} />
            {!!duration && <Text style={[styles.chipText, TABULAR_NUMS]}>{duration}</Text>}
          </View>
        )}
        {post.media === 'slideshow' && (
          <View style={[styles.topRight, styles.chip]}>
            <Feather name="copy" size={11} color={ON_PHOTO} />
          </View>
        )}
        {price != null && (
          <View style={[styles.bottomLeft, styles.chip]}>
            <Text style={[styles.priceText, TABULAR_NUMS]}>{formatCents(price)}</Text>
          </View>
        )}
      </View>
      {showCreator ? <View style={styles.byline}>
        {post.authorAvatarUrl ? (
          <CachedImage source={{ uri: post.authorAvatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: post.authorColor }]}>
            <Text style={styles.avatarInitials}>{post.authorInitials.slice(0, 1)}</Text>
          </View>
        )}
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{post.authorName}</Text>
      </View> : null}
    </Pressable>
  );
}

export function DiscoverMasonryTileSkeleton({ width, imageHeight }: { width: number; imageHeight: number }) {
  return (
    <View style={{ width }}>
      <SkeletonBlock width={width} height={imageHeight} radius={radius.lg} />
      <View style={styles.byline}>
        <SkeletonBlock width={MASONRY_AVATAR} height={MASONRY_AVATAR} radius={MASONRY_AVATAR / 2} />
        <SkeletonBlock width={Math.round(width * 0.45)} height={10} radius={4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageWrap: { width: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, gap: 6 },
  fallbackInitials: { fontFamily: FONT.bold, fontSize: 18 },
  fallbackCaption: { fontFamily: FONT.regular, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: PHOTO_SHADE, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3,
  },
  topRight: { position: 'absolute', top: 8, right: 8 },
  bottomLeft: { position: 'absolute', left: 8, bottom: 8 },
  chipText: { color: ON_PHOTO, fontFamily: FONT.semibold, fontSize: 11, lineHeight: 13 },
  priceText: { color: ON_PHOTO, fontFamily: FONT.semibold, fontSize: 12, lineHeight: 15 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, height: MASONRY_AVATAR },
  avatar: { width: MASONRY_AVATAR, height: MASONRY_AVATAR, borderRadius: MASONRY_AVATAR / 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: ON_PHOTO, fontFamily: FONT.bold, fontSize: 10, lineHeight: 12 },
  name: { flex: 1, minWidth: 0, fontFamily: FONT.medium, fontSize: 13, lineHeight: 16 },
});

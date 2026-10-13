/**
 * One Explore-grid tile — edge-to-edge cover image, a small play glyph for
 * video or a stack glyph for a slideshow/carousel post (Instagram Explore
 * convention). Long-press opens the safety menu (Report / Not interested /
 * Mute); a tap opens the full-screen DiscoverPostViewer at this tile.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/layout';
import { FONT, FS, TEXT_TERTIARY } from '@/lib/theme';
import type { DiscoverPost } from '@/lib/discoverFeed';
import { formatVideoDuration } from '@/lib/discoverFormat';
import { TABULAR_NUMS } from '@/constants/typography';

export function DiscoverTileView({
  post, width, height, onPress, onLongPress,
}: {
  post: DiscoverPost;
  width: number;
  height: number;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${post.authorName}${post.caption ? `: ${post.caption}` : ''}`}
      testID={`discover-tile-${post.id}`}
      style={{ width, height }}
    >
      {post.imageUri ? (
        // Tiles are 3:4, matching how photos are now saved (cropped by the
        // creator to 3:4 at post time). "cover" so off-ratio (older) content
        // fills the tile instead of leaving grey/black letterbox bands and
        // uneven-looking gutters (QA-0269/0909); the full image is one tap
        // away in the post viewer.
        <CachedImage
          source={{ uri: post.imageUri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={post.id}
        />
      ) : (
        // Some real posts (e.g. the current public Trending endpoint) carry
        // no image at all — a monochrome text card instead of a broken
        // photo icon, so the grid still reads as content rather than a
        // loading failure. Initials + caption, same treatment app-wide.
        <View style={[styles.image, styles.fallback]}>
          <Text style={styles.fallbackInitials}>{post.authorInitials}</Text>
          {!!post.caption && (
            <Text style={styles.fallbackCaption} numberOfLines={3}>{post.caption}</Text>
          )}
        </View>
      )}
      {post.media === 'slideshow' && (
        <View style={styles.glyphWrap}>
          <Icon name="copy" size={13} color="#FFFFFF" />
        </View>
      )}
    </Pressable>
  );
}

export function DiscoverTileSkeleton({ width, height }: { width: number; height: number }) {
  return <SkeletonBlock width={width} height={height} radius={0} />;
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%', backgroundColor: '#111' },
  fallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, gap: 4 },
  fallbackInitials: { color: TEXT_TERTIARY, fontFamily: FONT.bold, fontSize: FS.md },
  fallbackCaption: { color: TEXT_TERTIARY, fontFamily: FONT.regular, fontSize: 11, textAlign: 'center' },
  glyphWrap: { position: 'absolute', top: 6, right: 6 },
  videoGlyph: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  duration: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 11 },
});

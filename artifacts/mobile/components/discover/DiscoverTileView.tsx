/**
 * One Explore-grid tile — edge-to-edge cover image, a small play glyph for
 * video or a stack glyph for a slideshow/carousel post (Instagram Explore
 * convention). Long-press opens the safety menu (Report / Not interested /
 * Mute); a tap opens the full-screen DiscoverPostViewer at this tile.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/layout';
import { FONT, FS, TEXT_TERTIARY } from '@/lib/theme';
import type { DiscoverPost } from '@/lib/discoverFeed';

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
        // creator to 3:4 at post time) — "contain" so a tile never crops
        // beyond the creator's own chosen crop, even for older content that
        // predates this system and isn't exactly 3:4.
        <CachedImage
          source={{ uri: post.imageUri }}
          style={styles.image}
          contentFit={post.media === 'video' ? 'cover' : 'contain'}
          cachePolicy="memory-disk"
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
      {post.media === 'video' && (
        <View style={styles.glyphWrap}>
          <Feather name="play" size={13} color="#FFFFFF" />
        </View>
      )}
      {post.media === 'slideshow' && (
        <View style={styles.glyphWrap}>
          <Feather name="copy" size={13} color="#FFFFFF" />
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
});

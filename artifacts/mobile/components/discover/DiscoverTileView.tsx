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
import { FONT, FS } from '@/lib/theme';
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

// Same solid fill a real tile shows before its image decodes (styles.image
// below), so skeleton → content is a seamless swap. Not the theme-tinted
// SkeletonBlock: on the black/white/silver theme `cardElevated` is pure
// black, which made the loading grid an invisible "blank screen".
export const TILE_PLACEHOLDER_COLOR = '#111';

export function DiscoverTileSkeleton({ width, height }: { width: number; height: number }) {
  return <View style={{ width, height, backgroundColor: TILE_PLACEHOLDER_COLOR }} />;
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%', backgroundColor: TILE_PLACEHOLDER_COLOR },
  fallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, gap: 4 },
  fallbackInitials: { color: '#FFFFFF99', fontFamily: FONT.bold, fontSize: FS.md },
  fallbackCaption: { color: '#FFFFFF66', fontFamily: FONT.regular, fontSize: 11, textAlign: 'center' },
  glyphWrap: { position: 'absolute', top: 6, right: 6 },
});

/**
 * One Explore-grid tile — edge-to-edge cover image, a small play glyph for
 * video or a stack glyph for a slideshow/carousel post (Instagram Explore
 * convention), and the post's views (video) or likes (photo) bottom-left
 * (IG/TikTok grid convention — Mobbin: Instagram
 * https://mobbin.com/screens/8ad9bc33-805a-49a9-81d1-e4ea5cedd476, TikTok
 * https://mobbin.com/screens/8a609a59-c946-41f5-844f-46d85456fabe). The
 * creator is shown in the viewer on tap, not repeated under every tile.
 * Long-press opens the safety menu (Report / Not interested / Mute); a tap
 * opens the full-screen DiscoverPostViewer at this tile.
 *
 * Never black forever: every item from GET /api/public/discover carries an
 * image (poster / first slide / photo). If it fails to load the tile retries
 * a few times with backoff and otherwise settles on a neutral placeholder.
 * Memoized so appending a page never re-renders tiles already on screen.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import type { DiscoverPost } from '@/lib/discoverFeed';

/** Backoff before each automatic reload of a tile image that failed. */
export const TILE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** Views for a video, likes for anything else; null when there's nothing worth showing. */
export function tileStat(post: Pick<DiscoverPost, 'media' | 'likesCount' | 'likesHidden' | 'viewsCount'>): { icon: 'play' | 'heart'; label: string } | null {
  if (post.media === 'video' && (post.viewsCount ?? 0) > 0) return { icon: 'play', label: formatCompactCount(post.viewsCount) };
  if (!post.likesHidden && post.likesCount > 0) return { icon: 'heart', label: formatCompactCount(post.likesCount) };
  return null;
}

function DiscoverTileViewImpl({
  post, width, height, onPress, onLongPress,
}: {
  post: DiscoverPost;
  width: number;
  height: number;
  onPress: (post: DiscoverPost) => void;
  onLongPress: (post: DiscoverPost) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setAttempt(0); setFailed(false); setLoaded(false); }, [post.imageUri]);

  const handleError = useCallback(() => {
    const delay = TILE_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) { setFailed(true); return; }
    timer.current = setTimeout(() => setAttempt((a) => a + 1), delay);
  }, [attempt]);

  const stat = tileStat(post);

  return (
    <Pressable
      onPress={() => onPress(post)}
      onLongPress={() => onLongPress(post)}
      accessibilityRole="button"
      accessibilityLabel={`${post.authorName}${post.caption ? `: ${post.caption}` : ''}`}
      testID={`discover-tile-${post.id}`}
      // The neutral fill only shows while loading; once the image is in, a
      // photo's own letterboxing ("contain") reads as page black, not grey bars.
      style={[styles.tile, { width, height }, loaded && styles.loaded]}
    >
      {post.imageUri && !failed ? (
        // Tiles are 3:4, matching how photos are now saved (cropped by the
        // creator to 3:4 at post time) — "contain" so a tile never crops
        // beyond the creator's own chosen crop, even for older content that
        // predates this system and isn't exactly 3:4.
        <CachedImage
          key={attempt}
          source={{ uri: post.imageUri }}
          style={[styles.image, loaded && styles.loaded]}
          contentFit={post.media === 'photo' ? 'contain' : 'cover'}
          cachePolicy="memory-disk"
          recyclingKey={post.id}
          placeholder={TILE_PLACEHOLDER_BLURHASH}
          transition={120}
          onLoad={() => setLoaded(true)}
          onError={handleError}
          testID={`discover-tile-image-${post.id}`}
        />
      ) : (
        // Image missing or permanently failing — a quiet neutral card, never
        // an endless black square.
        <View style={[styles.image, styles.fallback]} testID={`discover-tile-fallback-${post.id}`}>
          <Feather name="image" size={18} color="#FFFFFF55" />
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
      {stat && (
        <View style={styles.stat} pointerEvents="none">
          <Feather name={stat.icon} size={11} color="#FFFFFF" />
          <Text style={styles.statText} numberOfLines={1}>{stat.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const DiscoverTileView = memo(DiscoverTileViewImpl, (a, b) =>
  a.post === b.post && a.width === b.width && a.height === b.height
  && a.onPress === b.onPress && a.onLongPress === b.onLongPress);

// Neutral (not pure black) so a loading or failed tile reads as a placeholder
// against the black background, and identical to DiscoverTileSkeleton so
// skeleton → content is a seamless swap. Not the theme-tinted SkeletonBlock:
// on the black/white/silver theme `cardElevated` is pure black, which made
// the loading grid an invisible "blank screen".
export const TILE_PLACEHOLDER_COLOR = '#1C1C1E';

/** 1x1-component blurhash of TILE_PLACEHOLDER_COLOR: a flat neutral fill
 *  while the image decodes, instead of CachedImage's colourful default. */
const TILE_PLACEHOLDER_BLURHASH = { blurhash: '003IYL' };

export function DiscoverTileSkeleton({ width, height }: { width: number; height: number }) {
  return <View style={{ width, height, backgroundColor: TILE_PLACEHOLDER_COLOR }} />;
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden', backgroundColor: TILE_PLACEHOLDER_COLOR },
  image: { width: '100%', height: '100%', backgroundColor: TILE_PLACEHOLDER_COLOR },
  loaded: { backgroundColor: 'transparent' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  glyphWrap: { position: 'absolute', top: 6, right: 6 },
  stat: { position: 'absolute', left: 6, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  statText: {
    color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.xs,
    textShadowColor: '#00000099', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});

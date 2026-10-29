/**
 * 9:16 video tiles — the main content of every profile. Each tile is one
 * pressable (poster, view count, and badges are all non-interactive children).
 */
import React, { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/components/ui/Icon';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/layout';
import { setPendingTileTransition } from '@/lib/tileTransition';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import { posterForPost } from '@/services/profileService';
import type { SellerThreadPost } from '@/services/socialService';
import type { BuyerPost } from '@/services/socialTypes';
import { InteractionLayer } from './ProfileControls';
import { PROFILE_GRID_GAP } from './profileLayout';

export interface ProfileGridItem {
  id: string;
  kind: 'video' | 'photo' | 'slideshow';
  posterUri: string | null;
  caption: string;
  viewsCount?: number;
  likesCount?: number;
  productCount: number;
  /** 'profile' = a POST (opens the 3:4 carousel viewer); 'thread' = a Threads video (opens the feed player). */
  surface?: 'thread' | 'profile';
  /** Number of slides in a POST carousel (shows the carousel badge when > 1). */
  slideCount?: number;
  /** Owner-only lifecycle label, e.g. Draft / Scheduled. */
  statusLabel?: string;
  /** Pinned to the author's profile (Instagram pushpin glyph, top-right). */
  pinned?: boolean;
}

function kindOf(type: string | undefined): ProfileGridItem['kind'] {
  if (type === 'video' || type === 'behind_scenes') return 'video';
  if (type === 'slideshow') return 'slideshow';
  return 'photo';
}

export function gridItemFromThreadPost(post: SellerThreadPost): ProfileGridItem {
  const statusLabel = post.isDraft
    ? 'Draft'
    : post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now()
      ? 'Scheduled'
      : undefined;
  return {
    id: post.id,
    kind: kindOf(post.contentType),
    posterUri: posterForPost(post),
    caption: post.caption ?? '',
    viewsCount: post.viewsCount,
    likesCount: post.likesCount,
    productCount: post.productTags?.length ?? 0,
    slideCount: post.slides?.length ?? (post.mediaUris?.length > 1 ? post.mediaUris.length : undefined),
    surface: post.surface,
    statusLabel,
    pinned: !!post.pinnedAt,
  };
}

export function gridItemFromBuyerPost(post: BuyerPost): ProfileGridItem {
  const kind = kindOf(post.type);
  return {
    id: post.id,
    kind,
    // A buyer video's mediaUrl is the clip itself, not an image — carousel posts carry a poster per slide.
    posterUri: post.slides?.[0]?.thumbnailUrl ?? (kind === 'video' ? null : post.mediaUrl ?? null),
    slideCount: post.slides?.length ?? (post.mediaUrls && post.mediaUrls.length > 1 ? post.mediaUrls.length : undefined),
    caption: post.caption ?? '',
    likesCount: post.likesCount,
    productCount: 0,
    pinned: !!post.pinnedAt,
  };
}

function tileLabel(item: ProfileGridItem): string {
  const noun = item.kind === 'video' ? 'video' : item.kind === 'slideshow' ? 'slideshow' : 'photo';
  const parts = [`Play ${noun}`];
  if (item.pinned) parts.push('Pinned');
  if (typeof item.viewsCount === 'number') parts.push(`${formatCompactCount(item.viewsCount)} views`);
  if (item.productCount > 0) parts.push(`${item.productCount} product${item.productCount === 1 ? '' : 's'} tagged`);
  if (item.statusLabel) parts.push(item.statusLabel);
  if (item.caption) parts.push(item.caption.slice(0, 80));
  return parts.join(', ');
}

export const ProfileVideoTile = React.memo(function ProfileVideoTile({
  item,
  index,
  width,
  height,
  onPress,
  onLongPress,
}: {
  item: ProfileGridItem;
  index: number;
  width: number;
  height: number;
  onPress: (item: ProfileGridItem, index: number) => void;
  onLongPress?: (item: ProfileGridItem, index: number) => void;
}) {
  const { theme } = useAppTheme();
  const tileRef = useRef<View>(null);
  // Zoom from the tile: measure it, hand its rect to the viewer (which grows
  // a copy of the poster into place — components/ExpandFromTileOverlay),
  // then navigate. Falls straight through when the tile can't be measured.
  const handlePress = useCallback(() => {
    const node = tileRef.current;
    if (!node || typeof node.measureInWindow !== 'function') { onPress(item, index); return; }
    node.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setPendingTileTransition({ postId: item.id, uri: item.posterUri ?? null, rect: { x, y, width: w, height: h } });
      onPress(item, index);
    });
  }, [onPress, item, index]);
  const handleLongPress = useCallback(() => onLongPress?.(item, index), [onLongPress, item, index]);
  // A "▶ 0" badge reads as broken, not as data — no count until there is one.
  const metric = item.kind === 'video' && typeof item.viewsCount === 'number' && item.viewsCount > 0
    ? { icon: 'play' as const, value: formatCompactCount(item.viewsCount) }
    : typeof item.likesCount === 'number' && item.likesCount > 0
      ? { icon: 'heart' as const, value: formatCompactCount(item.likesCount) }
      : null;

  return (
    <View ref={tileRef} collapsable={false} style={{ width, height, marginBottom: PROFILE_GRID_GAP }}>
      <PressableScale
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        activeScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={tileLabel(item)}
        testID={`profile-video-tile-${item.id}`}
        style={[styles.tile, { width, height, backgroundColor: theme.cardElevated }]}
      >
        {(state) => (
          <>
            {item.posterUri ? (
              // Every kind (video, photo, slideshow) fills the cell with a
              // full-bleed `cover` poster — a photo whose shape differs from
              // the cell is center-cropped to it.
              <CachedImage
                source={{ uri: item.posterUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={150}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
                <Icon name={item.kind === 'video' ? 'film' : 'image'} size={22} color={theme.muted} />
                {item.caption ? (
                  <Text style={[styles.placeholderCaption, { color: theme.subtle }]} numberOfLines={3}>{item.caption}</Text>
                ) : null}
              </View>
            )}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} // theme-exempt: legibility scrim over media
              style={styles.scrim}
            />
            {item.pinned ? (
              // Instagram: a pinned tile shows only the pushpin in the top-right corner.
              <View style={styles.pinBadge} pointerEvents="none" testID={`profile-tile-pinned-${item.id}`}>
                <MaterialCommunityIcons name="pin" size={16} color="#FFFFFF" /* theme-exempt: over media */ style={styles.pinGlyph} />
              </View>
            ) : (item.slideCount ?? 0) > 1 || item.kind === 'slideshow' ? (
              // Instagram: only a carousel gets a corner glyph — a single
              // photo is the default and carries no badge (the old "photo"
              // glyph plus the bag badge cluttered both top corners).
              <View style={styles.kindBadge} pointerEvents="none">
                <Icon name="layers" size={11} color="#FFFFFF" /* theme-exempt: over media */ />
              </View>
            ) : null}
            {item.productCount > 0 ? (
              <View style={styles.bagBadge} pointerEvents="none">
                <Icon name="shopping-bag" size={11} color="#FFFFFF" /* theme-exempt: over media */ />
              </View>
            ) : null}
            {item.statusLabel ? (
              <View style={[styles.status, { backgroundColor: theme.cardGlass, borderColor: theme.warning }]} pointerEvents="none">
                <Text style={[styles.statusText, { color: theme.warning }]}>{item.statusLabel}</Text>
              </View>
            ) : null}
            {metric ? (
              <View style={styles.metric} pointerEvents="none">
                <Icon name={metric.icon} size={15} color="#FFFFFF" /* theme-exempt: over media */ />
                <Text style={styles.metricText}>{metric.value}</Text>
              </View>
            ) : null}
            <InteractionLayer state={state as { pressed: boolean }} radius={0} theme={theme} />
          </>
        )}
      </PressableScale>
    </View>
  );
});

/** Skeleton in the exact tile geometry, so data swaps in without a jump. */
export function ProfileGridSkeleton({ columns, width, height, rows = 2 }: { columns: number; width: number; height: number; rows?: number }) {
  return (
    <View style={styles.skeletonGrid} accessibilityLabel="Loading videos" accessible>
      {Array.from({ length: columns * rows }).map((_, index) => (
        <SkeletonBlock key={index} width={width} height={height} radius={0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Square-cornered, hairline-gapped: the grid reads as one wall of video.
  tile: { borderRadius: 0, overflow: 'hidden', minHeight: 0 },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingHorizontal: SP.sm },
  placeholderCaption: { fontFamily: FONT.medium, fontSize: FS.xs, textAlign: 'center', lineHeight: 15 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
  pinBadge: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  pinGlyph: {
    transform: [{ rotate: '45deg' }],
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3, // theme-exempt: legibility over media
  },
  kindBadge: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)', // theme-exempt: scrim over media
    alignItems: 'center', justifyContent: 'center',
  },
  bagBadge: {
    position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)', // theme-exempt: scrim over media
    alignItems: 'center', justifyContent: 'center',
  },
  status: {
    position: 'absolute', bottom: 6, right: 6, borderWidth: 1, borderRadius: RADIUS.pill,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  statusText: { fontFamily: FONT.semibold, fontSize: 11, lineHeight: 13 },
  metric: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  metricText: {
    color: '#FFFFFF', // theme-exempt: over media
    fontFamily: FONT.bold, fontSize: FS.base, lineHeight: 18, letterSpacing: -0.2, fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: PROFILE_GRID_GAP },
});

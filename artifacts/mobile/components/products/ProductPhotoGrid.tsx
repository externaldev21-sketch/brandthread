/**
 * Product editor photo grid (Shopify iOS media grid, reskinned):
 * 3-column square tiles with a numbered order badge on each photo
 * (1 = first in the listing), a "Cover" tag on the cover photo, remove (×)
 * and move earlier/later controls, and a dashed "+ Add" tile at the end.
 * Pure presentation — picking, uploading, cropping and reordering stay with
 * the screen that owns the media list.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';

export interface PhotoGridItem {
  id: string;
  /** Displayable uri, or null to show a placeholder. */
  uri: string | null;
  isCover: boolean;
  busy: boolean;
  error: 'upload' | 'cutout' | null;
}

interface Props {
  items: PhotoGridItem[];
  max: number;
  onAdd: () => void;
  onPressItem: (id: string) => void;
  onLongPressItem: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRetry: (id: string, kind: 'upload' | 'cutout') => void;
}

const COLUMNS = 3;
const GAP = SP.sm;

export function photoGridTileSize(containerWidth: number, columns = COLUMNS, gap = GAP): number {
  return Math.max(0, Math.floor((containerWidth - gap * (columns - 1)) / columns));
}

export function ProductPhotoGrid({ items, max, onAdd, onPressItem, onLongPressItem, onRemove, onMove, onRetry }: Props) {
  const { theme } = useAppTheme();
  const [width, setWidth] = useState(0);
  const tile = width > 0 ? photoGridTileSize(width) : 96;
  const scrim = `${theme.background}B3`;
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };

  return (
    <View style={styles.grid} onLayout={onLayout} testID="add-product-photo-grid">
      {items.map((m, idx) => (
        <PressableScale
          key={m.id}
          style={[styles.tile, { width: tile, height: tile, borderColor: theme.border, backgroundColor: theme.surface }]}
          onPress={() => onPressItem(m.id)}
          onLongPress={() => onLongPressItem(m.id)}
          activeScale={0.98}
          accessibilityLabel={`Photo ${idx + 1}${m.isCover ? ', cover' : ''}. Tap to crop, hold for more options.`}
          testID={`add-product-photo-${m.id}`}
        >
          {m.uri ? (
            <Image source={{ uri: m.uri }} style={styles.img} resizeMode="cover" />
          ) : (
            <View style={[styles.img, styles.center]}>
              <Feather name="image" size={20} color={theme.muted} />
            </View>
          )}

          <View style={[styles.badge, { backgroundColor: idx === 0 ? theme.text : scrim }]} testID={`add-product-photo-badge-${idx + 1}`}>
            <Text style={[styles.badgeText, { color: idx === 0 ? theme.background : theme.text }]}>{idx + 1}</Text>
          </View>

          {m.isCover && (
            <View style={[styles.coverTag, { backgroundColor: scrim }]}>
              <Text style={[styles.coverText, { color: theme.text }]}>Cover</Text>
            </View>
          )}

          {m.busy && (
            <View style={[styles.overlay, { backgroundColor: scrim }]}>
              <ActivityIndicator color={theme.text} />
            </View>
          )}
          {!m.busy && m.error && (
            <PressableScale
              style={[styles.overlay, { backgroundColor: scrim }]}
              onPress={() => onRetry(m.id, m.error as 'upload' | 'cutout')}
              accessibilityLabel={m.error === 'upload' ? 'Retry photo upload' : 'Retry background removal'}
            >
              <Feather name="refresh-cw" size={16} color={theme.text} />
              <Text style={[styles.retryText, { color: theme.text }]}>{m.error === 'upload' ? 'Retry upload' : 'Retry cutout'}</Text>
            </PressableScale>
          )}

          <PressableScale
            style={[styles.remove, { backgroundColor: scrim }]}
            onPress={() => onRemove(m.id)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            noMinHeight
            accessibilityLabel="Remove photo"
          >
            <Feather name="x" size={14} color={theme.text} />
          </PressableScale>

          {items.length > 1 && (
            <View style={styles.reorder}>
              <PressableScale
                disabled={idx === 0}
                onPress={() => onMove(m.id, -1)}
                style={[styles.reorderBtn, { backgroundColor: scrim }, idx === 0 && styles.disabled]}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 4 }}
                noMinHeight
                accessibilityLabel="Move photo earlier"
              >
                <Feather name="chevron-left" size={14} color={theme.text} />
              </PressableScale>
              <PressableScale
                disabled={idx === items.length - 1}
                onPress={() => onMove(m.id, 1)}
                style={[styles.reorderBtn, { backgroundColor: scrim }, idx === items.length - 1 && styles.disabled]}
                hitSlop={{ top: 10, bottom: 10, left: 4, right: 6 }}
                noMinHeight
                accessibilityLabel="Move photo later"
              >
                <Feather name="chevron-right" size={14} color={theme.text} />
              </PressableScale>
            </View>
          )}
        </PressableScale>
      ))}

      {items.length < max && (
        <PressableScale
          style={[styles.tile, styles.addTile, { width: tile, height: tile, borderColor: theme.muted }]}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add photo"
          testID="add-product-add-photos"
        >
          <Feather name="plus" size={20} color={theme.text} />
          <Text style={[styles.addText, { color: theme.text }]}>Add</Text>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  img: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: SP.xs,
    left: SP.xs,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    lineHeight: 14,
  },
  coverTag: {
    position: 'absolute',
    left: SP.xs,
    bottom: SP.xs,
    borderRadius: RADIUS.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverText: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    lineHeight: 14,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
  },
  retryText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
  remove: {
    position: 'absolute',
    top: SP.xs,
    right: SP.xs,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorder: {
    position: 'absolute',
    right: SP.xs,
    bottom: SP.xs,
    flexDirection: 'row',
    gap: SP.xs,
  },
  reorderBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  addTile: {
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
  },
  addText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
});

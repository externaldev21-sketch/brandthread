/**
 * Brandthread AI Tools — reference-photo tile grid
 *
 * The "add 1-N reference photos, each a small removable thumbnail, plus a
 * dashed add-more tile" pattern, shared between Mockup to Model and AI
 * Photoshoot (both let a seller attach several reference images). One
 * implementation so the two tools stay visually identical here, per Dev's
 * shared-components ask.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { Feather } from '@expo/vector-icons';
import { BORDER, CARD, FG, MUTED, RADIUS } from '@/lib/theme';

const TILE_SIZE = 88;

interface ReferencePhotoTilesProps {
  uris: string[];
  max: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  label?: string;
}

export function ReferencePhotoTiles({ uris, max, onAdd, onRemove, label = 'reference' }: ReferencePhotoTilesProps) {
  return (
    <View style={s.grid}>
      {uris.map((uri, idx) => (
        <View key={`${uri}-${idx}`} style={s.tile}>
          <CachedImage source={{ uri }} style={s.thumb} contentFit="cover" />
          <TouchableOpacity
            style={s.removeBtn}
            onPress={() => onRemove(idx)}
            accessibilityLabel={`Remove ${label} ${idx + 1}`}
            accessibilityRole="button"
          >
            <Feather name="x" size={12} color="#fff" />
          </TouchableOpacity>
        </View>
      ))}
      {uris.length < max && (
        <TouchableOpacity
          style={s.addTile}
          onPress={onAdd}
          accessibilityLabel={`Add ${label} photo`}
          accessibilityRole="button"
        >
          <Feather name="plus" size={22} color={MUTED} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

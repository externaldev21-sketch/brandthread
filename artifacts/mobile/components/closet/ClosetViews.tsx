/**
 * Digital Closet building blocks (Whering wardrobe grid + outfit board,
 * reskinned): a piece tile (photo, brand · size), an outfit board that lays
 * pieces out on a plain grid, and the Pieces / Outfits switch that sits under
 * the profile tabs.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { boardLayout, pieceCaption } from '@/lib/closet';
import { FONT, FS, SP } from '@/lib/theme';
import type { ClosetPiece } from '@/services/closetService';
import { editionLabel, type PieceEdition } from '@/lib/editions';

/** Every product photo in the app is 4:5. */
export const PIECE_PHOTO_ASPECT = 5 / 4;

function PiecePhoto({ piece, width, height }: { piece: ClosetPiece; width: number; height: number }) {
  const { theme } = useAppTheme();
  if (piece.imageUrl) {
    return <CachedImage source={{ uri: piece.imageUrl }} style={{ width, height, backgroundColor: theme.cardElevated }} accessibilityLabel={piece.name} />;
  }
  // No photo: the brand initial on a flat tile, same as everywhere else.
  return (
    <View style={[styles.initialTile, { width, height, backgroundColor: theme.cardElevated }]}>
      <Text style={[styles.initial, { color: theme.muted }]}>{(piece.brand ?? piece.name).trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function ClosetPieceTile({
  piece, width, selected, selectionIndex, onPress, footer, testID,
}: {
  piece: ClosetPiece;
  width: number;
  selected?: boolean;
  /** 1-based pick order, shown in the corner while picking. */
  selectionIndex?: number;
  onPress?: (piece: ClosetPiece) => void;
  /** Extra line under the caption (e.g. a numbered-piece proof). */
  footer?: React.ReactNode;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const height = Math.round(width * PIECE_PHOTO_ASPECT);
  const caption = pieceCaption(piece);
  return (
    <Pressable
      onPress={onPress ? () => onPress(piece) : undefined}
      style={{ width }}
      accessibilityRole="button"
      accessibilityState={selected !== undefined ? { selected } : undefined}
      accessibilityLabel={[piece.name, caption].filter(Boolean).join(', ')}
      testID={testID}
    >
      <View>
        <PiecePhoto piece={piece} width={width} height={height} />
        {selected ? (
          <View style={[styles.selectedMark, { backgroundColor: theme.text }]}>
            <Text style={[styles.selectedIndex, { color: theme.background }]}>{selectionIndex ?? ''}</Text>
          </View>
        ) : selected === false ? (
          <View style={[styles.unselectedMark, { borderColor: '#FFFFFF' }]} />
        ) : null}
      </View>
      <View style={styles.caption}>
        <Text style={[styles.captionText, { color: theme.text }]} numberOfLines={1}>{piece.brand ?? piece.name}</Text>
        {piece.size ? <Text style={[styles.captionMeta, { color: theme.muted }]} numberOfLines={1}>{piece.size}</Text> : null}
        {footer}
      </View>
    </Pressable>
  );
}

/** "No. 014 of 200" under a numbered piece (Closet only). */
export function PieceEditionLine({ edition }: { edition: PieceEdition }) {
  const { theme } = useAppTheme();
  return <Text style={[styles.edition, { color: theme.text }]} numberOfLines={1} testID="closet-piece-edition">{editionLabel(edition)}</Text>;
}

/** The pieces of one outfit, tiled edge to edge on a 4:5 board. */
export function OutfitBoard({ pieces, width, testID }: { pieces: ClosetPiece[]; width: number; testID?: string }) {
  const { theme } = useAppTheme();
  const height = Math.round(width * PIECE_PHOTO_ASPECT);
  const cells = boardLayout(pieces.length);
  return (
    <View style={{ width, height, backgroundColor: theme.cardElevated, overflow: 'hidden' }} testID={testID}>
      {cells.map((cell, i) => {
        const piece = pieces[i];
        const w = Math.round(cell.w * width);
        const h = Math.round(cell.h * height);
        return (
          <View key={`${piece.id}-${i}`} style={{ position: 'absolute', left: Math.round(cell.x * width), top: Math.round(cell.y * height), width: w, height: h, padding: 0.5 }}>
            <PiecePhoto piece={piece} width={w - 1} height={h - 1} />
          </View>
        );
      })}
    </View>
  );
}

export function ClosetOutfitTile({ pieces, width, onPress, testID }: { pieces: ClosetPiece[]; width: number; onPress: () => void; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <Pressable onPress={onPress} style={{ width }} accessibilityRole="button" accessibilityLabel={`Outfit, ${pieces.length} pieces`} testID={testID}>
      <OutfitBoard pieces={pieces} width={width} />
      <View style={styles.caption}>
        <Text style={[styles.captionMeta, { color: theme.muted }]} numberOfLines={1}>
          {pieces.length === 1 ? '1 piece' : `${pieces.length} pieces`}
        </Text>
      </View>
    </Pressable>
  );
}

/** Plain empty state: a title and a text action — no icon badge, no explainer. */
export function ClosetEmpty({ title, action, minHeight }: { title: string; action?: { label: string; onPress: () => void }; minHeight?: number }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.empty, minHeight ? { minHeight } : null]} testID="closet-empty">
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button" testID="closet-empty-action">
          <Text style={[styles.emptyAction, { color: theme.text }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type ClosetView = 'pieces' | 'outfits';

export function ClosetSubBar({
  view, pieceCount, outfitCount, onView, onNewOutfit,
}: {
  view: ClosetView;
  pieceCount: number;
  outfitCount: number;
  onView: (view: ClosetView) => void;
  onNewOutfit: (() => void) | null;
}) {
  const { theme } = useAppTheme();
  const seg = (key: ClosetView, label: string, count: number) => {
    const active = view === key;
    return (
      <Pressable
        onPress={() => onView(key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        hitSlop={8}
        testID={`closet-view-${key}`}
      >
        <Text style={[styles.segText, { color: active ? theme.text : theme.muted }]}>
          {label} <Text style={styles.segCount}>{count}</Text>
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.subBar} accessibilityRole="tablist">
      <View style={styles.segs}>
        {seg('pieces', 'Pieces', pieceCount)}
        {seg('outfits', 'Outfits', outfitCount)}
      </View>
      {onNewOutfit ? (
        <Pressable onPress={onNewOutfit} hitSlop={8} accessibilityRole="button" style={styles.newOutfit} testID="closet-new-outfit">
          <Feather name="plus" size={16} color={theme.text} />
          <Text style={[styles.segText, { color: theme.text }]}>New outfit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  initialTile: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: FONT.semibold, fontSize: FS.xl },
  selectedMark: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  selectedIndex: { fontFamily: FONT.bold, fontSize: FS.xs },
  unselectedMark: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  caption: { paddingHorizontal: SP.xs + 2, paddingTop: 6, paddingBottom: SP.sm + 2, gap: 1 },
  captionText: { fontFamily: FONT.medium, fontSize: FS.sm },
  captionMeta: { fontFamily: FONT.regular, fontSize: FS.meta },
  edition: { fontFamily: FONT.semibold, fontSize: FS.meta, fontVariant: ['tabular-nums'], marginTop: 2 },
  subBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm + 2,
  },
  segs: { flexDirection: 'row', gap: SP.md + 4 },
  segText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  segCount: { fontFamily: FONT.regular },
  newOutfit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  empty: { alignItems: 'center', paddingTop: SP.xl, paddingHorizontal: SP.lg, gap: SP.sm },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md },
  emptyAction: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
});

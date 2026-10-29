/**
 * Numbered-piece proof card: the buyer's number in a limited run, shown from
 * their Closet only. Plain type on black with the real product photo.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui/Button';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { editionNumberLabel } from '@/lib/editions';
import { FONT, FS, SP } from '@/lib/theme';
import type { ClosetPiece } from '@/services/closetService';

const INK = '#000000';
const PAPER = '#FFFFFF';
const SILVER = '#A7A7AD';
const HAIRLINE = '#2C2C30';

function orderedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ClosetProofCard({ piece, onClose, onViewProduct }: {
  piece: ClosetPiece | null;
  onClose: () => void;
  onViewProduct?: (piece: ClosetPiece) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const edition = piece?.edition ?? null;
  return (
    <Modal visible={!!piece && !!edition} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top + SP.md, paddingBottom: insets.bottom + SP.md }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        {piece && edition ? (
          <View style={styles.card} testID="closet-proof-card">
            <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" testID="closet-proof-close">
              <Feather name="x" size={20} color={PAPER} />
            </Pressable>
            {piece.imageUrl ? <CachedImage source={{ uri: piece.imageUrl }} style={styles.photo} accessibilityLabel={piece.name} /> : <View style={[styles.photo, styles.photoBlank]} />}
            <View style={styles.body}>
              <Text style={styles.brand} numberOfLines={1}>{piece.brand ?? ''}</Text>
              <Text style={styles.name} numberOfLines={2}>{piece.name}</Text>
              <View style={styles.rule} />
              <Text style={styles.number} accessibilityLabel={`${editionNumberLabel(edition)} of ${edition.size}`}>{editionNumberLabel(edition)}</Text>
              <Text style={styles.of}>of {edition.size.toLocaleString('en-US')}</Text>
              <View style={styles.rule} />
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Ordered</Text>
                <Text style={styles.metaValue}>{orderedOn(piece.orderedAt)}</Text>
              </View>
              {piece.size ? (
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Size</Text>
                  <Text style={styles.metaValue}>{piece.size}</Text>
                </View>
              ) : null}
            </View>
            {piece.productId && onViewProduct ? (
              <View style={styles.footer}>
                <Button label="View product" variant="secondary" fullWidth onPress={() => onViewProduct(piece)} testID="closet-proof-view-product" />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.86)', justifyContent: 'center', paddingHorizontal: SP.lg },
  card: { backgroundColor: INK, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, borderRadius: 4, overflow: 'hidden' },
  close: { position: 'absolute', top: SP.sm, right: SP.sm, zIndex: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: INK, borderRadius: 16 },
  photo: { width: '100%', aspectRatio: 4 / 5, maxHeight: 300 },
  photoBlank: { backgroundColor: '#111114' },
  body: { paddingHorizontal: SP.md + 4, paddingTop: SP.md, paddingBottom: SP.sm },
  brand: { fontFamily: FONT.medium, fontSize: FS.meta, color: SILVER, letterSpacing: 0.4, textTransform: 'uppercase' },
  name: { fontFamily: FONT.semibold, fontSize: FS.md, color: PAPER, marginTop: 2 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: HAIRLINE, marginVertical: SP.sm + 2 },
  number: { fontFamily: FONT.bold, fontSize: 44, color: PAPER, letterSpacing: -1, fontVariant: ['tabular-nums'] }, // type-exempt: share-card stat, display size
  of: { fontFamily: FONT.regular, fontSize: FS.base, color: SILVER, marginTop: -2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  metaLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: SILVER },
  metaValue: { fontFamily: FONT.medium, fontSize: FS.sm, color: PAPER },
  footer: { paddingHorizontal: SP.md + 4, paddingBottom: SP.md, paddingTop: SP.xs },
});

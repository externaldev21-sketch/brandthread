/**
 * Brandthread AI Tools — results grid (shared)
 *
 * Renders a batch of AiResultSlot as a 2-column grid: a visible shimmer
 * tile while generating (not a spinner page), a failed tile with Retry,
 * or the finished image with a tap-to-expand affordance and a compact
 * per-tile action row. Shared between Mockup to Model, AI Photoshoot, and
 * (their results grid specifically) Remove Background's single-result
 * case reuses the same tile visuals at N=1.
 */
import React from 'react';
import { ActivityIndicator, Dimensions, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { BORDER, CARD, FG, MUTED, RED, RED_DIM, SP, RADIUS, ICON, FONT, FS, SUBTLE } from '@/lib/theme';
import type { AiResultSlot } from './AiResultTypes';

const { width: SW } = Dimensions.get('window');
const COL_W = (SW - SP.lg * 2 - SP.sm) / 2;

interface AiResultsGridProps {
  slots: AiResultSlot[];
  onOpen: (id: number) => void;
  onRetry: (id: number) => void;
  onSaveToLibrary?: (id: number, imageUri: string) => void;
  onDownload?: (id: number, imageUri: string) => void;
  onUseAsProduct?: (imageUri: string) => void;
  savingId?: number | null;
  libraryId?: number | null;
}

export function AiResultsGrid({
  slots, onOpen, onRetry, onSaveToLibrary, onDownload, onUseAsProduct, savingId, libraryId,
}: AiResultsGridProps) {
  return (
    <View style={s.grid}>
      {slots.map((slot) => (
        <AiResultTile
          key={slot.id}
          slot={slot}
          onOpen={() => onOpen(slot.id)}
          onRetry={() => onRetry(slot.id)}
          onSaveToLibrary={onSaveToLibrary ? () => onSaveToLibrary(slot.id, slot.imageUri!) : undefined}
          onDownload={onDownload ? () => onDownload(slot.id, slot.imageUri!) : undefined}
          onUseAsProduct={onUseAsProduct ? () => onUseAsProduct(slot.imageUri!) : undefined}
          saving={savingId === slot.id}
          savingToLibrary={libraryId === slot.id}
        />
      ))}
    </View>
  );
}

function AiResultTile({
  slot, onOpen, onRetry, onSaveToLibrary, onDownload, onUseAsProduct, saving, savingToLibrary,
}: {
  slot: AiResultSlot;
  onOpen: () => void;
  onRetry: () => void;
  onSaveToLibrary?: () => void;
  onDownload?: () => void;
  onUseAsProduct?: () => void;
  saving: boolean;
  savingToLibrary: boolean;
}) {
  if (slot.status === 'generating') {
    return (
      <View style={s.tile}>
        <View style={s.tileBody}>
          <SkeletonBlock width={COL_W} height={COL_W * 1.3} radius={0} style={{ backgroundColor: BORDER }} />
          <View style={s.generatingLabel} pointerEvents="none">
            <Text style={s.generatingLabelText}>Generating…</Text>
          </View>
        </View>
        <View style={s.meta}>
          <Text style={s.metaText}>{slot.label}</Text>
        </View>
      </View>
    );
  }

  if (slot.status === 'failed') {
    return (
      <View style={[s.tile, s.tileFailed]}>
        <View style={s.failedBody}>
          <Feather name="alert-circle" size={ICON.lg} color={RED} />
          <Text style={s.failedText}>{slot.error ?? 'Generation failed'}</Text>
          <Button
            label="Retry"
            icon="refresh-cw"
            variant="secondary"
            size="compact"
            style={{ marginTop: SP.xs }}
            onPress={onRetry}
            accessibilityLabel={`Retry ${slot.label}`}
          />
        </View>
        <View style={s.meta}>
          <Text style={s.metaText}>{slot.label} · Failed</Text>
        </View>
      </View>
    );
  }

  if (slot.status === 'done' && slot.imageUri) {
    const actions: Array<{ icon: keyof typeof Feather.glyphMap; onPress: () => void; label: string; loading?: boolean }> = [];
    if (onSaveToLibrary) actions.push({ icon: 'bookmark', onPress: onSaveToLibrary, label: 'Save to library', loading: savingToLibrary });
    if (onDownload) actions.push({ icon: 'download', onPress: onDownload, label: 'Download', loading: saving });
    if (onUseAsProduct) actions.push({ icon: 'package', onPress: onUseAsProduct, label: 'Use as product photo' });
    actions.push({ icon: 'refresh-cw', onPress: onRetry, label: `Regenerate ${slot.label}` });

    return (
      <View style={s.tile}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onOpen}
          accessibilityLabel={`View ${slot.label} full-screen`}
          accessibilityRole="button"
        >
          <Image source={{ uri: slot.imageUri }} style={s.image} resizeMode="cover" />
          <View style={s.expandPill}>
            <Feather name="maximize-2" size={11} color="#fff" />
          </View>
        </TouchableOpacity>
        <View style={s.meta}>
          <Text style={s.metaText}>{slot.label}</Text>
        </View>
        <View style={s.actionsRow}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.label}
              style={s.actionBtn}
              onPress={a.onPress}
              accessibilityLabel={a.label}
              disabled={a.loading}
            >
              {a.loading ? <ActivityIndicator size="small" color={FG} /> : <Feather name={a.icon} size={ICON.sm} color={FG} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return null;
}

export { COL_W as AI_RESULT_COL_W };

const s = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  tile: {
    width: COL_W,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },
  tileFailed: {
    borderColor: RED,
  },
  tileBody: {
    width: COL_W,
    height: COL_W * 1.3,
  },
  image: {
    width: COL_W,
    height: COL_W * 1.3,
  },
  expandPill: {
    position: 'absolute',
    top: SP.xs,
    right: SP.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatingLabel: {
    position: 'absolute',
    bottom: SP.xs,
    left: SP.xs,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  generatingLabelText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: '#fff',
  },
  failedBody: {
    width: COL_W,
    height: COL_W * 1.3,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.md,
    gap: SP.sm,
    backgroundColor: RED_DIM,
  },
  failedText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: RED,
    textAlign: 'center',
    lineHeight: 16,
  },
  meta: {
    paddingHorizontal: SP.sm,
    paddingTop: SP.xs,
    paddingBottom: SP.xs,
  },
  metaText: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: SP.xs,
    padding: SP.sm,
    paddingTop: 0,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

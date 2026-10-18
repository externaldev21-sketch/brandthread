/**
 * Depop's "Add photos (Up to 8)" block at the top of Sell an item: a single
 * horizontal row of square photos (✕ to remove), the optional video, one
 * dashed "+" tile, and a full-width "Edit photos" button for reordering and
 * picking the cover. With no media yet it is Vinted's centred
 * "Upload photos" button instead of empty placeholder boxes.
 *
 * Tile width fits exactly four across at any phone width, so up to three
 * photos plus the "+" tile never get cut off at the edge.
 */
import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';
import { Button } from '@/components/ui/Button';
import { MAX_PHOTOS } from '@/lib/listing/taxonomy';
import type { ListingForm } from '@/lib/listing/listingStore';

const GAP = SP.sm;

export function PhotoStrip({
  form, onAdd, onRemove, onRetry, onRemoveVideo, onEdit, error,
}: {
  form: ListingForm;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onRemoveVideo: () => void;
  onEdit: () => void;
  error?: boolean;
}) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 600) - SP.md * 2 - GAP * 3) / 4);
  const scrollRef = React.useRef<ScrollView>(null);
  const count = form.photos.length;
  const hasMedia = count > 0 || !!form.video;

  React.useEffect(() => {
    if (count > 3) scrollRef.current?.scrollToEnd({ animated: true });
  }, [count]);

  return (
    <View style={s.wrap} testID="listing-photos">
      <View style={s.header}>
        <Text style={[s.title, error && { color: theme.error }]}>Add photos</Text>
        <Text style={s.limit} testID="listing-photos-limit">{`(Up to ${MAX_PHOTOS})`}</Text>
      </View>

      {!hasMedia ? (
        <View style={s.empty}>
          <Button label="Upload photos" icon="plus" variant="secondary" size="small" onPress={onAdd} testID="listing-upload-photos" />
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.row}
          >
            {form.photos.map((p, i) => (
              <View key={p.id} style={[s.tile, { width: tile, height: tile }]} testID={`listing-photo-${i}`}>
                <Image source={{ uri: p.uri }} style={s.image} accessibilityLabel={i === 0 ? 'Cover photo' : `Photo ${i + 1}`} />
                {p.status === 'uploading' ? (
                  <View style={s.overlay}><ActivityIndicator color={theme.text} /></View>
                ) : p.status === 'error' ? (
                  <Pressable style={s.overlay} onPress={() => onRetry(p.id)} accessibilityRole="button" accessibilityLabel="Retry upload">
                    <Feather name="rotate-cw" size={20} color={theme.text} />
                  </Pressable>
                ) : null}
                <RemoveDot onPress={() => onRemove(p.id)} label={`Remove photo ${i + 1}`} s={s} theme={theme} />
              </View>
            ))}
            {form.video ? (
              <View style={[s.tile, s.videoTile, { width: tile, height: tile }]} testID="listing-video-tile">
                <Feather name="play" size={22} color={theme.text} />
                <Text style={s.videoLabel}>Video</Text>
                <RemoveDot onPress={onRemoveVideo} label="Remove video" s={s} theme={theme} />
              </View>
            ) : null}
            {count < MAX_PHOTOS ? (
              <Pressable
                onPress={() => { hapticLight(); onAdd(); }}
                style={({ pressed }) => [s.tile, s.addTile, { width: tile, height: tile }, pressed && { backgroundColor: theme.surface }]}
                accessibilityRole="button"
                accessibilityLabel="Add photos"
                testID="listing-add-photo"
              >
                <Feather name="plus" size={24} color={theme.text} />
              </Pressable>
            ) : null}
          </ScrollView>
          {count > 1 ? (
            <View style={s.editWrap}>
              <Button label="Edit photos" variant="secondary" size="small" fullWidth onPress={onEdit} testID="listing-edit-photos" />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function RemoveDot({ onPress, label, s, theme }: { onPress: () => void; label: string; s: ReturnType<typeof makeStyles>; theme: AppThemePreset }) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      hitSlop={8}
      style={s.remove}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name="x" size={12} color={theme.text} />
    </Pressable>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    wrap: { paddingTop: SP.md, paddingBottom: SP.md, backgroundColor: t.background },
    header: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: SP.md, marginBottom: SP.sm + 4 },
    title: { fontSize: FS.base, fontFamily: FONT.semibold, color: t.text },
    limit: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted },
    empty: { height: 120, alignItems: 'center', justifyContent: 'center' },
    row: { paddingHorizontal: SP.md, gap: GAP },
    tile: { borderRadius: 6, overflow: 'hidden', backgroundColor: t.surface },
    image: { width: '100%', height: '100%' },
    overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.background}99` },
    remove: {
      position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center', backgroundColor: t.background, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
    },
    videoTile: { alignItems: 'center', justifyContent: 'center', gap: 2 },
    videoLabel: { fontSize: FS.meta, fontFamily: FONT.medium, color: t.text },
    addTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: t.muted },
    editWrap: { paddingHorizontal: SP.md, paddingTop: SP.md },
  });
}

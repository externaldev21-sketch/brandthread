/**
 * Stories / highlights rail. Every item — including the leading "New" — uses
 * the same fixed-width cell (circle + one-line label), so the "New" bubble
 * lines up with the highlights beside it instead of floating out of place.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { InteractionLayer } from './ProfileControls';

const CELL = 72;
const CIRCLE = 62;
// `size="sm"`: Instagram's own-profile highlights — smaller circles and
// labels, so the rail reads as one quiet row (even with only "New" in it).
const CELL_SM = 64;
const CIRCLE_SM = 54;

export interface ProfileStoryItem {
  id: string;
  label: string;
  emoji?: string;
  coverColor?: string;
  /** Saved-story cover photo; replaces the emoji when present. */
  imageUri?: string | null;
}

export function ProfileStoriesRow({
  items,
  onNew,
  newLabel = 'New',
  onPressItem,
  size = 'md',
}: {
  items: ProfileStoryItem[];
  onNew?: () => void;
  newLabel?: string;
  onPressItem: (item: ProfileStoryItem) => void;
  size?: 'md' | 'sm';
}) {
  const { theme } = useAppTheme();
  const sm = size === 'sm';
  const cell = sm ? styles.cellSm : styles.cell;
  const press = sm ? [styles.press, styles.pressSm] : styles.press;
  const circle = sm ? [styles.circle, styles.circleSm] : styles.circle;
  const label = sm ? [styles.label, styles.labelSm] : styles.label;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Highlights"
    >
      {onNew ? (
        <View style={cell}>
          <PressableScale
            onPress={onNew}
            accessibilityRole="button"
            accessibilityLabel="New highlight"
            testID="profile-story-new"
            style={press}
          >
            {(state) => (
              <>
                <View style={[circle, styles.newCircle, { borderColor: theme.border, backgroundColor: theme.cardGlass }]}>
                  <Feather name="plus" size={sm ? 18 : 20} color={theme.text} />
                </View>
                <Text style={[label, { color: theme.muted }]} numberOfLines={1}>{newLabel}</Text>
                <InteractionLayer state={state as { pressed: boolean }} radius={12} theme={theme} />
              </>
            )}
          </PressableScale>
        </View>
      ) : null}
      {items.map((item) => (
        <View key={item.id} style={cell}>
          <PressableScale
            onPress={() => onPressItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} highlight`}
            style={press}
          >
            {(state) => (
              <>
                {/* Instagram's own highlight ring is a plain neutral outline —
                    the colour ring is reserved for an unseen story. The
                    theme accent here would misread as "unread" on every
                    saturated theme, so highlights use the same neutral
                    border every other profile chrome does. */}
                <View style={[circle, { borderColor: theme.border, backgroundColor: item.coverColor ?? theme.cardElevated }]}>
                  {item.imageUri ? <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} /> : item.emoji ? <Text style={styles.emoji}>{item.emoji}</Text> : <Feather name="star" size={18} color={theme.text} />}
                </View>
                <Text style={[label, { color: theme.muted }]} numberOfLines={1}>{item.label}</Text>
                <InteractionLayer state={state as { pressed: boolean }} radius={12} theme={theme} />
              </>
            )}
          </PressableScale>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: SP.md, gap: SP.xs, alignItems: 'flex-start' },
  cell: { width: CELL },
  press: { width: CELL, alignItems: 'center', gap: 6, paddingVertical: 2 },
  circle: {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  newCircle: { borderStyle: 'dashed' },
  emoji: { fontSize: 22 },
  label: { width: CELL, textAlign: 'center', fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14 },
  cellSm: { width: CELL_SM },
  pressSm: { width: CELL_SM, gap: 4 },
  circleSm: { width: CIRCLE_SM, height: CIRCLE_SM, borderRadius: CIRCLE_SM / 2, borderWidth: 1 },
  labelSm: { width: CELL_SM, fontSize: 11, lineHeight: 13 },
});

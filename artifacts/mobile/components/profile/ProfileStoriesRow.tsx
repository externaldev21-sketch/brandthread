/**
 * Stories / highlights rail. Every item — including the leading "New" — uses
 * the same fixed-width cell (circle + one-line label), so the "New" bubble
 * lines up with the highlights beside it instead of floating out of place.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { InteractionLayer } from './ProfileControls';

const CELL = 72;
const CIRCLE = 62;

export interface ProfileStoryItem {
  id: string;
  label: string;
  emoji?: string;
  coverColor?: string;
}

export function ProfileStoriesRow({
  items,
  onNew,
  newLabel = 'New',
  onPressItem,
}: {
  items: ProfileStoryItem[];
  onNew?: () => void;
  newLabel?: string;
  onPressItem: (item: ProfileStoryItem) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Highlights"
    >
      {onNew ? (
        <View style={styles.cell}>
          <PressableScale
            onPress={onNew}
            accessibilityRole="button"
            accessibilityLabel="New highlight"
            testID="profile-story-new"
            style={styles.press}
          >
            {(state) => (
              <>
                <View style={[styles.circle, styles.newCircle, { borderColor: theme.border, backgroundColor: theme.cardGlass }]}>
                  <Feather name="plus" size={20} color={theme.text} />
                </View>
                <Text style={[styles.label, { color: theme.muted }]} numberOfLines={1}>{newLabel}</Text>
                <InteractionLayer state={state as { pressed: boolean }} radius={12} theme={theme} />
              </>
            )}
          </PressableScale>
        </View>
      ) : null}
      {items.map((item) => (
        <View key={item.id} style={styles.cell}>
          <PressableScale
            onPress={() => onPressItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} highlight`}
            style={styles.press}
          >
            {(state) => (
              <>
                <View style={[styles.circle, { borderColor: theme.accent, backgroundColor: item.coverColor ?? theme.cardElevated }]}>
                  {item.emoji ? <Text style={styles.emoji}>{item.emoji}</Text> : <Feather name="star" size={18} color={theme.text} />}
                </View>
                <Text style={[styles.label, { color: theme.muted }]} numberOfLines={1}>{item.label}</Text>
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
});

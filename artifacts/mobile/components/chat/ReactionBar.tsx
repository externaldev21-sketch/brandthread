import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactionType } from '@/services/socialTypes';
import { useAppTheme } from '@/contexts/AppThemeContext';

/**
 * The small fixed reaction bar shown on long-press — six minimalist vector
 * glyphs (never a free-form emoji picker), matching the monochrome aesthetic.
 */
export const REACTION_CONFIG: ReadonlyArray<{ type: ReactionType; label: string }> = [
  { type: 'like', label: 'Like' },
  { type: 'love', label: 'Love' },
  { type: 'haha', label: 'Haha' },
  { type: 'wow',  label: 'Wow' },
  { type: 'sad',  label: 'Sad' },
  { type: 'fire', label: 'Fire' },
];

export function ReactionGlyph({ type, size, color }: { type: ReactionType; size: number; color: string }) {
  switch (type) {
    case 'like': return <Feather name="thumbs-up" size={size} color={color} />;
    case 'love': return <Feather name="heart" size={size} color={color} />;
    case 'haha': return <Feather name="smile" size={size} color={color} />;
    case 'wow':  return <Feather name="zap" size={size} color={color} />;
    case 'sad':  return <Feather name="frown" size={size} color={color} />;
    case 'fire': return <MaterialCommunityIcons name="fire" size={size} color={color} />;
    default:     return null;
  }
}

/** Reads a reaction's kind across both the local optimistic shape
 *  (`emoji`) and the server response shape (`reactionType`). */
export function reactionKind(r: { emoji?: string; reactionType?: string }): ReactionType {
  return (r.reactionType ?? r.emoji) as ReactionType;
}

/** Reads a reaction's author id across the local (`fromId`) and server
 *  (`userId`) response shapes. */
export function reactionAuthorId(r: { fromId?: string; userId?: string }): string {
  return r.fromId ?? r.userId ?? '';
}

/** Reads a reaction's author display name across both shapes. */
export function reactionAuthorName(r: { fromName?: string; userName?: string }): string {
  return r.fromName ?? r.userName ?? '?';
}

export function ReactionChipsRow({
  selected, onSelect, testIDPrefix,
}: {
  selected?: ReactionType | null;
  onSelect: (type: ReactionType) => void;
  testIDPrefix: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={s.row}>
      {REACTION_CONFIG.map((r) => {
        const isSelected = selected === r.type;
        return (
          <TouchableOpacity
            key={r.type}
            testID={`${testIDPrefix}-${r.type}`}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            style={[
              s.chip,
              { backgroundColor: isSelected ? theme.accentDim : 'transparent', borderColor: isSelected ? theme.accent : theme.border },
            ]}
            onPress={() => onSelect(r.type)}
            activeOpacity={0.7}
          >
            <ReactionGlyph type={r.type} size={18} color={isSelected ? theme.accent : theme.muted} />
            <Text style={[s.chipLabel, { color: isSelected ? theme.accent : theme.muted }]}>{r.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
  },
  chipLabel: { fontSize: 12, fontWeight: '600' },
});

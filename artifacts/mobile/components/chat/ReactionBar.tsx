import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ReactionType } from '@/services/socialTypes';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AppleEmoji } from '@/lib/appleEmoji';
import { reactionAuthorId, reactionAuthorName, reactionKind } from '@/lib/reactionShapes';
import { radius } from '@/constants/radii';

// Re-exported so existing call sites (app/buyer-conversation.tsx,
// app/seller-conversation.tsx) keep importing these from this file; the
// actual (react-native-free) implementation lives in lib/reactionShapes.ts —
// see that file's doc comment for why.
export { reactionAuthorId, reactionAuthorName, reactionKind };

/**
 * The small fixed reaction bar shown on long-press — six real emoji glyphs
 * (never a free-form emoji picker) — matches Instagram DM's "Tap and hold to
 * super react" row (mobbin.com/screens/5d13fdd9-75ad-43d6-9089-7b236e362b73).
 * The emoji themselves are naturally colorful; the glass/menu chrome around
 * them stays monochrome (see components/chat/ReactionOverlay.tsx).
 */
export const REACTION_CONFIG: ReadonlyArray<{ type: ReactionType; label: string }> = [
  { type: 'like', label: 'Like' },
  { type: 'love', label: 'Love' },
  { type: 'haha', label: 'Haha' },
  { type: 'wow',  label: 'Wow' },
  { type: 'sad',  label: 'Sad' },
  { type: 'fire', label: 'Fire' },
];

/** Real emoji glyph per reaction kind — the data model (`ReactionType`) is
 *  unchanged; only the rendered glyph moved from a vector icon to emoji. */
export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  haha: '😂',
  wow:  '😮',
  sad:  '😢',
  fire: '🔥',
};

export function ReactionGlyph({ type, size }: { type: ReactionType; size: number; color?: string }) {
  const emoji = REACTION_EMOJI[type];
  if (!emoji) return null;
  return <AppleEmoji emoji={emoji} size={size} />;
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
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1,
  },
  chipLabel: { fontSize: 12, fontWeight: '600' },
});

/**
 * StyleTagsPicker — reusable curated-taxonomy chip selector.
 *
 * Renders a wrapping grid of emoji+label chips from the STYLE_TAGS vocabulary.
 * Selected chips get a solid purple fill; unselected get a dim border.
 * Pass `max` to cap how many can be selected at once (default: unlimited).
 *
 * Usage:
 *   <StyleTagsPicker selected={styleTags} onChange={setStyleTags} />
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

export interface StyleTag {
  key:   string;   // stored value (lowercase, stable)
  label: string;   // display label
  emoji: string;
}

/** Canonical style-tag vocabulary — shared across posts and products. */
export const STYLE_TAGS: StyleTag[] = [
  { key: 'streetwear',    label: 'Streetwear',    emoji: '🧢' },
  { key: 'vintage',       label: 'Vintage',       emoji: '🕰️' },
  { key: 'y2k',           label: 'Y2K',           emoji: '✨' },
  { key: 'minimalist',    label: 'Minimalist',    emoji: '⚪' },
  { key: 'athleisure',    label: 'Athleisure',    emoji: '🏃' },
  { key: 'luxury',        label: 'Luxury',        emoji: '💎' },
  { key: 'cottagecore',   label: 'Cottagecore',   emoji: '🌿' },
  { key: 'dark_academia', label: 'Dark Academia', emoji: '📚' },
  { key: 'coastal',       label: 'Coastal',       emoji: '🌊' },
  { key: 'preppy',        label: 'Preppy',        emoji: '👔' },
  { key: 'gorpcore',      label: 'Gorpcore',      emoji: '🏕️' },
  { key: 'boho',          label: 'Boho',          emoji: '🌸' },
  { key: 'grunge',        label: 'Grunge',        emoji: '🎸' },
  { key: 'techwear',      label: 'Techwear',      emoji: '🔲' },
  { key: 'basics',        label: 'Basics',        emoji: '👕' },
];

interface Props {
  selected:  string[];
  onChange:  (tags: string[]) => void;
  /** Optional label shown above the chip grid */
  label?:    string;
  /** Maximum number of tags that can be selected (default: no limit) */
  max?:      number;
}

export default function StyleTagsPicker({ selected, onChange, label, max }: Props) {
  const { theme } = useAppTheme();
  function toggle(key: string) {
    const isOn = selected.includes(key);
    if (isOn) {
      onChange(selected.filter(k => k !== key));
    } else {
      if (max !== undefined && selected.length >= max) return; // at limit
      onChange([...selected, key]);
    }
  }

  return (
    <View style={styles.root}>
      {label ? (
        <Text style={styles.label}>{label}</Text>
      ) : null}
      {max !== undefined && selected.length >= max ? (
        <Text style={styles.maxHint}>Max {max} selected</Text>
      ) : null}
      <View style={styles.grid}>
        {STYLE_TAGS.map(tag => {
          const active = selected.includes(tag.key);
          return (
            <TouchableOpacity
              key={tag.key}
              style={[styles.chip, active && { borderColor: theme.accent, backgroundColor: theme.accentDim }]}
              onPress={() => toggle(tag.key)}
              activeOpacity={0.75}
            >
              <Text style={styles.chipEmoji}>{tag.emoji}</Text>
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {tag.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: SP.xs,
  },
  label: {
    color:         MUTED,
    fontSize:      FS.xs,
    fontFamily:    FONT.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom:  SP.xs,
  },
  maxHint: {
    color:      SUBTLE,
    fontSize:   FS.xs,
    fontFamily: FONT.regular,
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  chip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               5,
    paddingHorizontal: 11,
    paddingVertical:   7,
    borderRadius:      RADIUS.pill,
    borderWidth:       1,
    borderColor:       BORDER,
    backgroundColor:   CARD,
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipLabel: {
    fontSize:   FS.sm,
    fontFamily: FONT.medium,
    color:      MUTED,
  },
  chipLabelActive: {
    color: FG,
  },
});

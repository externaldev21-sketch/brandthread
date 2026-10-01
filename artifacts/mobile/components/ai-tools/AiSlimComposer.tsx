/**
 * Brandthread AI Tools — slim single-line composer
 *
 * Dev's follow-up ask for AI Photoshoot's "Describe the shoot" field: a
 * slim single-line composer "matching whatever slim composer style is
 * already used elsewhere app-wide" rather than a boxed multi-line
 * textarea. Reuses `components/ai/AiComposer.tsx`'s frosted-pill visual
 * language (rounded pill, subtle border, blurred/tinted fill) — the only
 * slim single-line composer pattern already in this codebase — without
 * its send/stop-button chat plumbing, since this is a plain form field,
 * not a chat input.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { CARD, FG, SUBTLE, BORDER, FONT, FS } from '@/lib/theme';

interface AiSlimComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  icon?: keyof typeof Feather.glyphMap;
  accessibilityLabel?: string;
}

export function AiSlimComposer({ value, onChangeText, placeholder, icon = 'edit-3', accessibilityLabel }: AiSlimComposerProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.pill, focused && s.pillFocused]}>
      {Platform.OS !== 'android' && (
        <BlurView pointerEvents="none" intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <View pointerEvents="none" style={s.tint} />
      <Feather name={icon} size={15} color={SUBTLE} style={s.icon} />
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={SUBTLE}
        numberOfLines={1}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingHorizontal: 16,
    gap: 10,
  },
  pillFocused: {
    borderColor: FG,
  },
  tint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: `${CARD}CC`,
  },
  icon: { zIndex: 1 },
  input: {
    flex: 1,
    zIndex: 1,
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    padding: 0,
  },
});

/**
 * A–Z list index on the right edge (S5 #100), the iOS Contacts section
 * index (UIKit sectionIndexTitles; Apple HIG › Lists and tables): a column
 * of letters you tap or drag along to jump. Each new letter under the finger
 * gives a selection tick. No bubble, no animation: the list jumping is the
 * feedback.
 */
import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { INDEX_LETTERS, letterAtOffset, type IndexLetter } from '@/lib/alphabetIndex';
import { hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';

interface Props {
  onLetter: (letter: IndexLetter) => void;
  style?: ViewStyle;
}

export function AlphabetScrubber({ onLetter, style }: Props) {
  const { theme } = useAppTheme();
  const height = useRef(0);
  const last = useRef<IndexLetter | null>(null);
  const onLetterRef = useRef(onLetter);
  onLetterRef.current = onLetter;

  const responder = useMemo(() => {
    const pick = (e: GestureResponderEvent) => {
      const letter = letterAtOffset(e.nativeEvent.locationY, height.current);
      if (letter === last.current) return;
      last.current = letter;
      hapticSelection();
      onLetterRef.current(letter);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the drag even when the finger slides off the strip sideways.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: pick,
      onPanResponderMove: pick,
      onPanResponderRelease: () => { last.current = null; },
      onPanResponderTerminate: () => { last.current = null; },
    });
  }, []);

  return (
    <View
      {...responder.panHandlers}
      testID="alphabet-scrubber"
      accessibilityRole="adjustable"
      accessibilityLabel="Jump to letter"
      onLayout={(e) => { height.current = e.nativeEvent.layout.height; }}
      style={[styles.strip, style]}
    >
      {INDEX_LETTERS.map((letter) => (
        // pointerEvents none: locationY must be relative to the strip itself.
        <Text key={letter} pointerEvents="none" style={[styles.letter, { color: theme.text }]}>{letter}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 28 wide so a thumb can find it; letters stay on the 11pt caption floor.
  strip: { width: 28, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  letter: { fontSize: 11, lineHeight: 14, fontFamily: FONT.semibold },
});

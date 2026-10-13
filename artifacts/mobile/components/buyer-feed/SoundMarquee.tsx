/**
 * Sound label that scrolls when it doesn't fit (polish #152), like TikTok's
 * "♫ original sound - creator" line. Static and ellipsized when it fits, on
 * an inactive page, or with Reduce Motion on, so only the playing video's
 * label moves, and only when there is more of it to read.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

const GAP = 28;
const PX_PER_SECOND = 30;
const START_DELAY_MS = 1200;

export function SoundMarquee({
  text, active, reduceMotion = false, textStyle, maxWidth,
}: {
  text: string;
  active: boolean;
  reduceMotion?: boolean;
  textStyle?: StyleProp<TextStyle>;
  /** Width the label may occupy; it scrolls when the text is wider. */
  maxWidth: number;
}) {
  const [textWidth, setTextWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  const overflows = textWidth > maxWidth + 1;
  const scrolling = active && overflows && !reduceMotion && maxWidth > 0;

  useEffect(() => {
    offset.setValue(0);
    if (!scrolling) return undefined;
    const distance = textWidth + GAP;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(START_DELAY_MS),
        Animated.timing(offset, {
          toValue: -distance,
          duration: (distance / PX_PER_SECOND) * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(offset, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scrolling, textWidth, offset]);

  return (
    <View style={[styles.clip, maxWidth > 0 && { maxWidth }]}>
      {/* Off-screen copy measures the label's natural one-line width. */}
      <View style={styles.measure} pointerEvents="none" aria-hidden>
        <Text style={textStyle} onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}>{text}</Text>
      </View>
      {scrolling ? (
        <Animated.View style={[styles.row, { width: maxWidth, transform: [{ translateX: offset }] }]}>
          <Text style={[textStyle, styles.noShrink]} numberOfLines={1}>{text}</Text>
          <View style={{ width: GAP }} />
          <Text style={[textStyle, styles.noShrink]} numberOfLines={1} aria-hidden>{text}</Text>
        </Animated.View>
      ) : (
        <Text style={textStyle} numberOfLines={1} ellipsizeMode="tail">{text}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', flexShrink: 1 },
  measure: { position: 'absolute', opacity: 0, flexDirection: 'row', width: 2000, left: 0, top: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  noShrink: { flexShrink: 0 },
});

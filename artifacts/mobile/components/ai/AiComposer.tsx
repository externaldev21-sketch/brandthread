/**
 * AiComposer — the floating glass input pill for the Brandthread AI screen.
 *
 * A compact frosted input with a silver edge glow that intensifies on focus,
 * and a send control that morphs into a stop square while the AI is
 * generating. Purely presentational — sending/stopping/text state all stay
 * owned by app/ai-brain.tsx; this component never talks to the AI backend.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { FONT, FS } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';

interface AiComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
  canSend: boolean;
  placeholder: string;
  accentColor: string;
  bottomInset: number;
}

export default function AiComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  isGenerating,
  canSend,
  placeholder,
  accentColor,
  bottomInset,
}: AiComposerProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const focus = useSharedValue(0);
  const morph = useSharedValue(isGenerating ? 1 : 0);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: reduceMotion ? 120 : 260 });
  }, [focused, reduceMotion, focus]);

  useEffect(() => {
    morph.value = withTiming(isGenerating ? 1 : 0, { duration: reduceMotion ? 100 : 220 });
  }, [isGenerating, reduceMotion, morph]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + focus.value * 0.55,
    borderColor: accentColor,
  }));

  const sendIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - morph.value,
    transform: [{ scale: 1 - morph.value * 0.4 }],
  }));

  const stopIconStyle = useAnimatedStyle(() => ({
    opacity: morph.value,
    transform: [{ scale: 0.6 + morph.value * 0.4 }],
  }));

  return (
    <View style={[styles.wrap, { paddingBottom: bottomInset }]}>
      <View style={styles.pillShadowWrap}>
        <Animated.View pointerEvents="none" style={[styles.edgeGlow, glowStyle]} />
        <View style={styles.pill}>
          {Platform.OS !== 'android' && (
            <BlurView pointerEvents="none" intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          )}
          <View pointerEvents="none" style={styles.pillTint} />

          <TextInput
            style={styles.textInput}
            // On web, an ancestor press handler dismisses the keyboard on
            // bubbled clicks. Keep the tap inside the composer so focus sticks.
            {...(Platform.OS === 'web' ? { onClick: (event: React.MouseEvent) => event.stopPropagation() } : {})}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.subtle}
            multiline
            returnKeyType="send"
            submitBehavior="submit"
            accessibilityLabel="Message Brandthread AI"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => {
              if (canSend) onSend();
            }}
            testID="ai-composer-input"
          />

          <Pressable
            onPress={isGenerating ? onStop : onSend}
            disabled={!isGenerating && !canSend}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={isGenerating ? 'Stop generating' : 'Send message'}
            style={styles.sendBtn}
            testID="ai-composer-send"
          >
            <Animated.View style={[StyleSheet.absoluteFill, styles.sendIconWrap, sendIconStyle]}>
              <Feather name="arrow-up" size={18} color={canSend ? accentColor : colors.subtle} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.sendIconWrap, stopIconStyle]}>
              <Feather name="square" size={16} color={accentColor} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  pillShadowWrap: {
    borderRadius: 23,
  },
  edgeGlow: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 24,
    borderWidth: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 23,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingLeft: 14,
    paddingRight: 3,
    paddingVertical: 2,
    minHeight: 44,
  },
  pillTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: `${colors.card}CC`,
  },
  textInput: {
    flex: 1,
    // Keep the composer one line tall at rest; longer text scrolls inside it.
    // The frosted layers are absolutely positioned, so explicitly paint the
    // text above them (otherwise typing works but the characters are hidden).
    zIndex: 1,
    height: 36,
    minHeight: 36,
    color: colors.text,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 20,
    paddingVertical: 7,
    paddingRight: 4,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  // 44x44 minimum comfortable touch target (COMP.minTouchTarget); was 40x40.
  sendBtn: {
    zIndex: 1,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

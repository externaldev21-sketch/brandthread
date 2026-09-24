/**
 * AiComposer — the floating glass input pill for the Brandthread AI screen.
 *
 * A premium frosted pill with a silver edge glow that intensifies on focus,
 * and a send control that morphs into a stop square while the AI is
 * generating. Purely presentational — sending/stopping/text state all stay
 * owned by app/ai-brain.tsx; this component never talks to the AI backend.
 */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CARD, FG, SUBTLE, FONT, FS } from '@/lib/theme';

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
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          )}
          <View style={styles.pillTint} />

          <TextInput
            style={styles.textInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={SUBTLE}
            multiline
            returnKeyType="send"
            blurOnSubmit={false}
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
              <Feather name="arrow-up" size={18} color={canSend ? accentColor : SUBTLE} />
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

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  pillShadowWrap: {
    borderRadius: 26,
  },
  edgeGlow: {
    position: 'absolute',
    top: -1.5,
    left: -1.5,
    right: -1.5,
    bottom: -1.5,
    borderRadius: 27.5,
    borderWidth: 1.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
  },
  pillTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: `${CARD}CC`,
  },
  textInput: {
    flex: 1,
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    paddingVertical: 10,
    paddingRight: 8,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

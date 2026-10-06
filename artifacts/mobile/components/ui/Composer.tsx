/**
 * Composer — the one slim text-entry bar for every "type at the bottom" screen
 * (DMs, group chats, comment sheets, AI chats, story replies, live chat).
 *
 * iMessage / X / Instagram DM pattern (Mobbin: X "Message" composer): an
 * optional left "+" style accessory beside a single-line pill (~40px) that
 * grows up to 5 lines and then scrolls, with a round 32px send button inside
 * the pill's right edge that scales in once there is something to send.
 *
 * API is intentionally small: value, onChangeText, onSend, placeholder,
 * leftAccessory. Everything else is optional polish.
 *
 * Mounting it hides the floating tab bar (useHideTabBar) so the bar sits on
 * the safe-area bottom with nothing overlapping it, and its bottom padding
 * follows the keyboard frame-by-frame so it never gaps or jumps.
 */
import React, { useEffect, useState } from 'react';
import {
  Platform, Pressable, StyleSheet, TextInput, View,
  type NativeSyntheticEvent, type StyleProp, type TextInputKeyPressEventData, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { FONT, FS } from '@/lib/theme';
import { a11yHidden } from '@/lib/a11yHidden';

export const COMPOSER_PILL_MIN_HEIGHT = 40;
export const COMPOSER_SEND_SIZE = 32;
const LINE_HEIGHT = 20;
const MAX_LINES = 5;
const INPUT_V_PAD = 10; // (40 - 20) / 2 → single line is exactly 40px
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_LINES + INPUT_V_PAD * 2;
const SIDE_GAP = 8;

export interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder?: string;
  /** Left of the pill, e.g. a round "+" attach button. */
  leftAccessory?: React.ReactNode;
  /** Inside the pill, right edge, shown while there is nothing to send (mic, coin…). */
  rightAccessory?: React.ReactNode;
  /** Defaults to value.trim().length > 0. */
  canSend?: boolean;
  /** Swaps the send button for a stop square (AI generation). */
  busy?: boolean;
  onStop?: () => void;
  editable?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  inputRef?: React.Ref<TextInput>;
  nativeID?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyPress?: (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
  /** Enter sends (web hardware keyboard). Shift+Enter inserts a newline. Default true. */
  enterToSend?: boolean;
  /** Content rendered above the pill row (reply banner, attachment chip, suggestions). */
  topSlot?: React.ReactNode;
  /** Set false on a composer inside a sheet that must leave the tab bar alone. */
  hideTabBar?: boolean;
  /** Composer floats over full-bleed media (live, stories): the wrapper is clear, only the pill is solid. */
  overMedia?: boolean;
  /** Extra bottom padding when the composer is not at the screen edge (e.g. in a sheet that already insets). */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

function TabBarHider() {
  useHideTabBar();
  return null;
}

export default function Composer({
  value, onChangeText, onSend, placeholder = 'Message…', leftAccessory, rightAccessory,
  canSend, busy = false, onStop, editable = true, maxLength, autoFocus, inputRef, nativeID,
  onFocus, onBlur, onKeyPress, enterToSend = true, topSlot, hideTabBar = true, overMedia = false, bottomInset,
  style, testID = 'composer', accessibilityLabel,
}: ComposerProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const restingBottom = bottomInset ?? Math.max(insets.bottom, 8);
  const { progress } = useReanimatedKeyboardAnimation();

  // Explicit content-driven height: native multiline inputs autosize, but a
  // web <textarea> defaults to 2 rows, so drive the height ourselves (1 → 5 lines).
  const [contentH, setContentH] = useState(LINE_HEIGHT);
  const inputH = value.length === 0
    ? COMPOSER_PILL_MIN_HEIGHT
    : Math.min(MAX_INPUT_HEIGHT, Math.max(COMPOSER_PILL_MIN_HEIGHT, contentH + INPUT_V_PAD * 2));

  const sendable = canSend ?? value.trim().length > 0;
  const showAction = sendable || busy;
  const actionScale = useSharedValue(showAction ? 1 : 0);
  useEffect(() => {
    actionScale.value = withTiming(showAction ? 1 : 0, { duration: reduceMotion ? 0 : 160 });
  }, [showAction, reduceMotion, actionScale]);

  // Bottom padding eases from the safe-area inset to a tight 8px as the
  // keyboard rises, in lockstep with the keyboard frame (no gap, no jump).
  const wrapStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(progress.value, [0, 1], [restingBottom, 8]),
  }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: actionScale.value,
    transform: [{ scale: 0.6 + 0.4 * actionScale.value }],
  }));

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    onKeyPress?.(e);
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
    if (Platform.OS === 'web' && enterToSend && ne.key === 'Enter' && !ne.shiftKey) {
      (e as any).preventDefault?.();
      if (sendable && !busy) onSend();
    }
  };

  return (
    <Animated.View
      style={[styles.wrap, { backgroundColor: overMedia ? 'transparent' : theme.background }, wrapStyle, style]}
      testID={testID}
    >
      {hideTabBar ? <TabBarHider /> : null}
      {topSlot}
      <View style={styles.row}>
        {leftAccessory ? <View style={styles.left}>{leftAccessory}</View> : null}
        <View style={[styles.pill, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <TextInput
            ref={inputRef}
            nativeID={nativeID}
            style={[
              styles.input,
              { height: inputH },
              { color: theme.text },
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            multiline
            numberOfLines={1}
            onContentSizeChange={(e) => setContentH(e.nativeEvent.contentSize.height - (Platform.OS === 'web' ? INPUT_V_PAD * 2 : 0))}
            editable={editable}
            maxLength={maxLength}
            autoFocus={autoFocus}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyPress={handleKeyPress}
            textAlignVertical="center"
            accessibilityLabel={accessibilityLabel ?? placeholder}
            testID={`${testID}-input`}
            {...(Platform.OS === 'web'
              ? { onClick: (e: React.MouseEvent) => e.stopPropagation() } as any
              : {})}
          />
          {!showAction && rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
          <Animated.View
            pointerEvents={showAction ? 'auto' : 'none'}
            style={[styles.actionSlot, actionStyle]}
            // Collapsed (nothing typed), the send button is invisible, shrunk
            // and disabled — keep it out of the screen-reader tree until it shows.
            {...a11yHidden(!showAction)}
          >
            <Pressable
              onPress={busy ? onStop : onSend}
              disabled={!showAction || (!busy && !sendable)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Stop' : 'Send'}
              style={[styles.send, { backgroundColor: theme.accent }]}
              testID={`${testID}-send`}
            >
              <Feather name={busy ? 'square' : 'arrow-up'} size={busy ? 14 : 18} color={theme.onAccent} />
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: SIDE_GAP },
  left: { height: COMPOSER_PILL_MIN_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: COMPOSER_PILL_MIN_HEIGHT,
    borderRadius: COMPOSER_PILL_MIN_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    paddingRight: (COMPOSER_PILL_MIN_HEIGHT - COMPOSER_SEND_SIZE) / 2,
  },
  input: {
    flex: 1,
    minHeight: COMPOSER_PILL_MIN_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingTop: INPUT_V_PAD,
    paddingBottom: INPUT_V_PAD,
    paddingHorizontal: 0,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    lineHeight: LINE_HEIGHT,
  },
  right: { height: COMPOSER_PILL_MIN_HEIGHT, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', paddingLeft: 6 },
  actionSlot: {
    width: COMPOSER_SEND_SIZE,
    height: COMPOSER_PILL_MIN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  send: {
    width: COMPOSER_SEND_SIZE,
    height: COMPOSER_SEND_SIZE,
    borderRadius: COMPOSER_SEND_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Brandthread Design System — IconButton (Phase 1)
 *
 * A 44x44pt minimum hit-area icon button. Thin wrapper over the existing
 * PressableScale press-feel with design-system tokens (RADII.chip, SPACING).
 */
import React from 'react';
import { Animated, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticLight } from '@/lib/haptics';
import { COMP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export interface IconButtonProps {
  name: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  color?: string;
  size?: number;
  /**
   * 'plain' — icon only, no background.
   * 'filled' (default) — themed card surface, for chrome over an ordinary screen background.
   * 'glass' — frosted, monochrome-white chrome for controls floating over full-bleed photo/video
   * content (e.g. the Discover pager), where the surface behind the button isn't the app's
   * own themed background and a theme-colored card would be unreadable against it.
   */
  variant?: 'plain' | 'filled' | 'glass';
  badge?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  name, onPress, accessibilityLabel, accessibilityHint, color, size = 20,
  variant = 'filled', badge, disabled = false, style, testID,
}: IconButtonProps) {
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const resolvedColor = color ?? (variant === 'glass' ? '#FFFFFF' : palette.foreground);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { hapticLight(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={testID}
      style={styles.hit}
    >
      <Animated.View
        style={[
          styles.root,
          variant === 'filled' && { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: RADII.chip },
          variant === 'glass' && { borderRadius: RADII.pill, overflow: 'hidden' },
          disabled && { opacity: 0.4 },
          { transform: [{ scale }] },
          style,
        ]}
      >
        {variant === 'glass' && (
          <>
            {Platform.OS !== 'android' && <GlassBlur style={StyleSheet.absoluteFill} />}
            <View style={[StyleSheet.absoluteFill, styles.glassTint]} />
          </>
        )}
        <Feather name={name} size={size} color={resolvedColor} />
        {typeof badge === 'number' && badge > 0 && (
          <View style={[styles.badge, { backgroundColor: palette.primary, borderColor: variant === 'glass' ? '#0A0A0B' : palette.background }]}>
            <Animated.Text style={[styles.badgeText, { color: palette.primaryForeground }]}>
              {badge > 99 ? '99+' : badge}
            </Animated.Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Requires expo-blur lazily, at first render of a glass-variant button,
 * instead of at module load — so screens/tests that never render a glass
 * IconButton (the common case) don't pull the native blur module into their
 * bundle/module graph at all.
 */
function GlassBlur({ style }: { style: StyleProp<ViewStyle> }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BlurView } = require('expo-blur') as { BlurView: typeof import('expo-blur').BlurView };
    return <BlurView intensity={50} tint="dark" style={style} />;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  hit: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  root: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  glassTint: { backgroundColor: 'rgba(10,10,11,0.35)' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
});

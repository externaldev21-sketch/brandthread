/**
 * Brandthread Design System — IconButton (Phase 1)
 *
 * A 44x44pt minimum hit-area icon button. Thin wrapper over the existing
 * PressableScale press-feel with design-system tokens (RADII.chip, SPACING).
 */
import React from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, View, ViewStyle, type GestureResponderEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { Glass } from '@/components/ui/Glass';
import { iconAccessibilityLabel } from '@/lib/a11y/iconLabels';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

export interface IconButtonProps {
  name: keyof typeof Feather.glyphMap;
  /** Receives the press event (a ⋯ button anchors its pull-down menu to it). */
  onPress: (event?: GestureResponderEvent) => void;
  /** Optional: when omitted (or empty) a default is derived from the icon `name` (see lib/a11y/iconLabels.ts). */
  accessibilityLabel?: string;
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
  /** Opt out of the Android/web ripple circle while keeping the scale press
   *  feel. Defaults to `true` (existing global behavior) — set `false` on a
   *  per-screen basis where the ripple reads as an unwanted translucent grey
   *  circle (e.g. the buyer Messages screens). */
  rippleEnabled?: boolean;
}

export function IconButton({
  name, onPress, accessibilityLabel, accessibilityHint, color, size = 20,
  variant = 'filled', badge, disabled = false, style, testID, rippleEnabled = true,
}: IconButtonProps) {
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const resolvedColor = color ?? (variant === 'glass' ? '#FFFFFF' : palette.foreground);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={iconAccessibilityLabel(name, accessibilityLabel)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={(event) => onPress(event)}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={testID}
      style={styles.hit}
      android_ripple={rippleEnabled ? { color: `${resolvedColor}33`, borderless: true, radius: COMP.iconBtn / 2 } : undefined}
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
          <Glass variant="regular" tint="dark" radius={RADII.pill} style={StyleSheet.absoluteFill} />
        )}
        <Feather name={name} size={size} color={resolvedColor} />
        {typeof badge === 'number' && badge > 0 && (
          <View style={[styles.badge, { backgroundColor: palette.primary, borderColor: variant === 'glass' ? '#0A0A0B' : palette.background }]}>
            <Animated.Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[styles.badgeText, { color: palette.primaryForeground }]}>
              {badge > 99 ? '99+' : badge}
            </Animated.Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  root: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
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
  // fontFamily, not fontWeight: without an explicit `fontFamily` this
  // badge digit rendered in the browser's default sans font on web (no
  // Inter face at all), and a bare numeric `fontWeight` on this app's
  // per-weight static Inter faces has no matching real weight file, so the
  // browser synthesizes ("faux-bolds") it instead of using a real bold
  // glyph — see components/ui/AppText.tsx's doc comment.
  badgeText: { fontSize: 10, fontFamily: FONT.bold },
});

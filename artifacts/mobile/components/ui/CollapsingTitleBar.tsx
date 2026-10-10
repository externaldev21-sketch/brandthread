/**
 * The compact state of a collapsing large-title header: a small (17pt
 * semibold) centered title that fades into the header bar once the large
 * title has scrolled away (hooks/useLargeTitleCollapse.ts).
 *
 * It is laid over ScreenHeader's own title row — same height, same back /
 * close button and action positions, no divider — so the bar never changes
 * size or moves anything between the resting and scrolled states; only the
 * titles swap. ScreenHeader renders it when given `collapse`; screens don't
 * use it directly.
 */
import React from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { COMP, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import type { LargeTitleCollapse } from '@/hooks/useLargeTitleCollapse';

/** Room kept clear on each side for the back button and up to two actions. */
const SIDE_CLEARANCE = COMP.iconBtn * 2 + SP.md + SP.xs;

export function CollapsingTitleBar({ title, collapse, bottomInset = 0 }: {
  title: string;
  collapse: LargeTitleCollapse;
  /** The header row's bottom padding, so the title centers on the buttons. */
  bottomInset?: number;
}) {
  const { theme } = useAppTheme();
  return (
    <Animated.View
      pointerEvents="none"
      // The large title stays the accessible header; this is a visual copy.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(Platform.OS === 'web' ? ({ 'aria-hidden': true } as object) : null)}
      testID="collapsing-title-bar"
      style={[styles.bar, { bottom: bottomInset }, collapse.compactTitleStyle]}
    >
      <Animated.Text
        numberOfLines={1}
        maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
        style={[TYPE_SCALE.headline, { color: theme.text }]}
      >
        {title}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: SIDE_CLEARANCE,
    right: SIDE_CLEARANCE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Layout props (flex, width, margins, alignSelf, position) size the whole
 * touch target, so they go on the outer Pressable; the rest (colours,
 * padding, radius overrides) stay on the visible button. Without this a
 * pair given `style={{ flex: 1 }}` put flex on the inner view, which
 * collapsed its 52pt height in a row (label spilling out of the outline)
 * and never shared the row's width equally.
 */
const OUTER_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'width', 'minWidth', 'maxWidth',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
]);

export function splitButtonStyle(style: StyleProp<ViewStyle>): { outerStyle: ViewStyle; innerStyle: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outerStyle: Record<string, unknown> = {};
  const innerStyle: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) (OUTER_KEYS.has(key) ? outerStyle : innerStyle)[key] = value;
  return { outerStyle: outerStyle as ViewStyle, innerStyle: innerStyle as ViewStyle };
}


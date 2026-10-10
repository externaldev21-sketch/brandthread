/**
 * The ONE icon badge every empty state in the app uses (both shared
 * EmptyState components render it — components/layout/EmptyState.tsx and
 * BrandthreadUI's EmptyState — so there is a single look app-wide).
 *
 * Dev's spec, after reviewing the seller profile's empty tabs:
 *  - The SAME icon family as the profile tab icons (Feather: grid / bag /
 *    tag), but drawn a bit THICKER than the tabs — a true ~2.25px stroke,
 *    not the icon font's fixed hairline.
 *  - A clearly THICKER ring: ~2px solid silver (#3a3a3a-#555 band), not a
 *    dull hairline, on a near-black fill.
 *  - The glyph OPTICALLY centred in the circle. Feather/lucide glyphs are
 *    not all centred in their own 24px box (a tag's body sits up-left, a
 *    briefcase sits high), so each icon carries a measured offset
 *    (emptyStateIcons.ts, generated from the real geometry) that moves its
 *    bounding-box centre onto the circle's centre. The glyph is drawn in a
 *    fixed square box, centred with alignItems/justifyContent.
 *
 * Icons not in the generated table fall back to the Feather font glyph at
 * the same size (still centred by its square box), so a new empty state
 * never renders blank.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon, type IconName } from '@/components/ui/Icon';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { EMPTY_STATE_ICONS } from './emptyStateIcons';

export const EMPTY_STATE_BADGE_SIZE = 64;
/** Ring: solid silver, ~2px. */
export const EMPTY_STATE_BADGE_RING_WIDTH = 2;
export const EMPTY_STATE_BADGE_RING_COLOR = '#4A4A4A';
/** Near-black fill. */
export const EMPTY_STATE_BADGE_FILL = '#0E0E0E';
/** Rendered stroke width of the glyph, in screen points (the profile tab
 *  icons are the Feather font at 24pt, which reads ~1.5-2pt). */
export const EMPTY_STATE_ICON_STROKE = 2.25;

const NODE_COMPONENTS = {
  path: Path,
  rect: Rect,
  circle: Circle,
  line: Line,
  polyline: Polyline,
  polygon: Polygon,
  ellipse: Ellipse,
} as const;

export function emptyStateIconSize(badgeSize: number): number {
  // ~44% of the circle — Instagram/Threads empty-state proportion.
  return Math.round(badgeSize * 0.44);
}

export function EmptyStateGlyph({
  name,
  size,
  color,
  strokeWidth = EMPTY_STATE_ICON_STROKE,
}: {
  name: string;
  size: number;
  color: string;
  /** In screen points (converted to the 24-unit grid internally). */
  strokeWidth?: number;
}) {
  const icon = EMPTY_STATE_ICONS[name];
  if (!icon) {
    return <Icon name={name as IconName} size={size} color={color} testID="empty-state-glyph-font" />;
  }
  const gridStroke = (strokeWidth * 24) / size;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID="empty-state-glyph">
      <G
        transform={`translate(${icon.dx} ${icon.dy})`}
        stroke={color}
        strokeWidth={gridStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {icon.nodes.map(([tag, attrs], i) => {
          const Node = NODE_COMPONENTS[tag] as React.ComponentType<Record<string, unknown>>;
          const props: Record<string, unknown> = { ...attrs };
          if (props.fill === 'currentColor') props.fill = color;
          return <Node key={i} {...props} />;
        })}
      </G>
    </Svg>
  );
}

export function EmptyStateBadge({
  icon,
  size = EMPTY_STATE_BADGE_SIZE,
  color,
  style,
  testID = 'empty-state-badge',
}: {
  icon: string;
  size?: number;
  /** Glyph colour; defaults to the theme's text white. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const glyph = emptyStateIconSize(size);
  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      {/* Fixed square box, centred both ways — the glyph's own measured
          offset (inside EmptyStateGlyph) does the optical part. */}
      <View style={{ width: glyph, height: glyph, alignItems: 'center', justifyContent: 'center' }}>
        <EmptyStateGlyph name={icon} size={glyph} color={color ?? theme.text} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: EMPTY_STATE_BADGE_RING_WIDTH,
    borderColor: EMPTY_STATE_BADGE_RING_COLOR,
    backgroundColor: EMPTY_STATE_BADGE_FILL,
  },
});

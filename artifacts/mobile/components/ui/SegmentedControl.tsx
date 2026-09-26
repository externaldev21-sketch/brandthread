/**
 * Brandthread Design System — SegmentedControl (Phase 1)
 *
 * A gliding-indicator segmented control/tab strip, built on the same
 * measured-layout approach as the buyer/seller tab bar indicator
 * (components/tab-bar/TabBarParts.tsx) so the "liquid glide" feel is
 * consistent app-wide.
 */
import React, { useCallback, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { TAB_INDICATOR_SPRING } from '@/constants/motion';

export interface SegmentedControlProps {
  options: { id: string; label: string }[];
  selectedId: string;
  onChange: (id: string) => void;
  testID?: string;
  /**
   * 'surface' (default): the original opaque card-background pill — every
   * existing call site keeps this and is visually unchanged.
   * 'glass': a translucent, blurred dark pill with light text, for sitting
   * directly on top of photo/video content (e.g. buyer-saved, the discover
   * pager) where an opaque card would look like a slapped-on control rather
   * than part of the media surface.
   * 'underline': plain text tabs (no filled pill/background at all) with a
   * thin sliding underline beneath the active label — the TikTok-style top
   * tab bar used by the buyer Threads Home feed's "Following / Threads"
   * switcher, which sits directly on video and must never read as a solid
   * control floating on top of it.
   */
  variant?: 'surface' | 'glass' | 'underline';
  /** Compact sizing (34pt tall instead of 40pt) for tight overlay contexts. */
  size?: 'default' | 'compact';
  /**
   * Extra style on the root pill — existing call sites never pass this and
   * are unaffected. Used to give the pill an explicit `minWidth` when its
   * parent is a `flex: 1` wrapper (e.g. centered between other top-bar
   * icons): without one, a row of `flex: 1` segments inside an
   * otherwise-unconstrained row collapses to its text's minimum content
   * size instead of the space actually available, truncating longer labels.
   */
  style?: StyleProp<ViewStyle>;
}

// Horizontal padding on each side of the pill's inner track (`styles.root`).
// The indicator's width/offset math must subtract this out on both sides —
// using the *full* measured root width instead left the indicator running
// `PILL_PADDING` past the track's right edge, which the pill's
// `overflow: 'hidden'` then clipped: the last segment's indicator (and, at
// the far end, part of its label hit-area) got cut off.
const PILL_PADDING = 3;

export function SegmentedControl({ options, selectedId, onChange, testID, variant = 'surface', size = 'default', style }: SegmentedControlProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const glass = variant === 'glass';
  const underline = variant === 'underline';
  const height = size === 'compact' ? 34 : 40;

  if (underline) {
    return (
      <UnderlineTabs
        options={options}
        selectedId={selectedId}
        onChange={onChange}
        testID={testID}
        height={height}
        style={style}
      />
    );
  }

  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? (trackWidth - PILL_PADDING * 2) / Math.max(options.length, 1) : 0;
  const activeIndex = Math.max(0, options.findIndex((option) => option.id === selectedId));
  const x = useSharedValue(activeIndex * segmentWidth);

  React.useEffect(() => {
    x.set(withSpring(activeIndex * segmentWidth, TAB_INDICATOR_SPRING));
  }, [activeIndex, segmentWidth, x]);

  const onLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.root,
        { height, borderRadius: RADII.pill },
        glass
          ? { backgroundColor: 'rgba(0,0,0,0.28)', borderColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' }
          : { backgroundColor: palette.card, borderColor: palette.border },
        style,
      ]}
      onLayout={onLayout}
      testID={testID}
    >
      {glass && Platform.OS !== 'android' && (
        <BlurView intensity={36} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      )}
      {segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: segmentWidth,
              backgroundColor: glass ? 'rgba(255,255,255,0.94)' : theme.accent,
              borderRadius: RADII.pill,
              top: 3,
              bottom: 3,
            },
            indicatorStyle,
          ]}
        />
      )}
      {options.map((option) => {
        const selected = option.id === selectedId;
        const selectedColor = glass ? '#111111' : theme.onAccent;
        const unselectedColor = glass ? 'rgba(255,255,255,0.82)' : palette.mutedForeground;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) { hapticToggle(); onChange(option.id); } }}
            style={[styles.segment, size === 'compact' && styles.segmentCompact]}
            testID={testID ? `${testID}-${option.id}` : undefined}
          >
            <Text
              style={[
                size === 'compact' ? styles.compactLabel : TYPE_SCALE.footnote,
                { fontFamily: selected ? FONT.semibold : FONT.medium, color: selected ? selectedColor : unselectedColor },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Gap between the text's own rendered bottom edge and the underline —
// measured from TikTok: the bar sits tight to the glyph baseline, not below
// the tab's padded touch target.
const UNDERLINE_GAP = 4.5;
// Underline thickness — thin, fully rounded caps.
const UNDERLINE_HEIGHT = 2.5;

/**
 * Plain-text TikTok-style tab bar: no pill/background at all, each label
 * sized to its own content (never clipped regardless of container width),
 * with a short underline that slides *and resizes* beneath the active tab
 * via a near-critically-damped spring (no bounce/overshoot).
 *
 * The underline's width and x-position come from measuring the active
 * label's own `<Text>` — not its padded `Pressable` touch target — via two
 * `measureInWindow` reads (root, then the text) subtracted against each
 * other. Measuring the touch target instead of the text itself was the
 * previous bug: it produced a small, arbitrarily-clamped stub sized off the
 * padded container rather than the actual glyphs, sitting nowhere near the
 * real text width.
 */
function UnderlineTabs({
  options, selectedId, onChange, testID, height, style,
}: {
  options: { id: string; label: string }[];
  selectedId: string;
  onChange: (id: string) => void;
  testID?: string;
  height: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const activeLayout = layouts[selectedId];
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const hasMeasuredOnce = useRef(false);
  const rootRef = useRef<View>(null);
  const textRefs = useRef<Record<string, Text | null>>({});

  React.useEffect(() => {
    if (!activeLayout) return;
    const underlineX = activeLayout.x;
    const underlineWidth = activeLayout.width;
    if (!hasMeasuredOnce.current) {
      // First measurement (mount / initial layout): snap in place instead of
      // sliding in from x=0, which read as an unintended "wipe" animation.
      x.set(underlineX);
      w.set(underlineWidth);
      hasMeasuredOnce.current = true;
    } else {
      x.set(withSpring(underlineX, TAB_INDICATOR_SPRING));
      w.set(withSpring(underlineWidth, TAB_INDICATOR_SPRING));
    }
  }, [activeLayout, x, w]);

  // Two absolute `measureInWindow` reads (root, then the label's own Text)
  // and a subtraction — not `onLayout`'s `nativeEvent.layout`, which is only
  // relative to the Text's immediate parent (the padded Pressable), not the
  // tablist root the underline is positioned within.
  const measureTab = useCallback((id: string) => {
    const root = rootRef.current;
    const label = textRefs.current[id];
    if (!root || !label) return;
    root.measureInWindow((rootX, rootY) => {
      label.measureInWindow((labelX, labelY, width, height) => {
        if (!Number.isFinite(rootX) || !Number.isFinite(labelX) || width <= 0 || height <= 0) return;
        const next = { x: labelX - rootX, y: labelY - rootY, width, height };
        setLayouts(prev => {
          const existing = prev[id];
          if (
            existing
            && Math.abs(existing.x - next.x) < 0.5
            && Math.abs(existing.y - next.y) < 0.5
            && Math.abs(existing.width - next.width) < 0.5
            && Math.abs(existing.height - next.height) < 0.5
          ) return prev;
          return { ...prev, [id]: next };
        });
      });
    });
  }, []);

  const handleTabLayout = useCallback((id: string) => {
    // Layout has just landed for this label, but on web the just-mounted
    // native view isn't always immediately measurable in the same tick —
    // deferring one frame makes measureInWindow reliably return real
    // numbers instead of occasionally reading a stale/zeroed rect.
    requestAnimationFrame(() => measureTab(id));
  }, [measureTab]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: w.value,
  }));

  return (
    <View
      ref={rootRef}
      accessibilityRole="tablist"
      style={[styles.underlineRoot, { height }, style]}
      testID={testID}
      onLayout={() => { for (const option of options) measureTab(option.id); }}
    >
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => { if (!selected) { hapticToggle(); onChange(option.id); } }}
            style={styles.underlineSegment}
            testID={testID ? `${testID}-${option.id}` : undefined}
          >
            <Text
              ref={(node) => { textRefs.current[option.id] = node; }}
              onLayout={() => handleTabLayout(option.id)}
              style={[
                styles.underlineLabel,
                {
                  fontFamily: selected ? FONT.bold : FONT.medium,
                  color: selected ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
                },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
      {!!activeLayout && (
        <Animated.View
          pointerEvents="none"
          style={[styles.underlineBar, { top: activeLayout.y + activeLayout.height + UNDERLINE_GAP }, indicatorStyle]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', borderWidth: 1, padding: PILL_PADDING },
  indicator: { position: 'absolute', left: PILL_PADDING },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xs },
  segmentCompact: { paddingHorizontal: 6 },
  compactLabel: { fontSize: 12, lineHeight: 15 },

  underlineRoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  underlineSegment: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  underlineLabel: {
    fontSize: 15, lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  // `left: 0` is load-bearing, not decorative: on web, an absolutely
  // positioned flex child with no inset (left/right/top/bottom) of its own
  // takes its *static* position from the parent's justify-content (here,
  // `underlineRoot`'s `center`) before any transform is applied — so without
  // this, translateX was being added on top of an already-centered position
  // instead of measured from the container's left edge, landing the
  // underline under the search icon instead of under the active tab.
  // `top` is set inline per-render from the measured label's own bottom
  // edge + UNDERLINE_GAP, not a fixed offset from the container — a fixed
  // offset from the padded touch target is what previously floated the bar
  // well below the actual glyphs instead of tight to the baseline.
  underlineBar: {
    position: 'absolute', left: 0, height: UNDERLINE_HEIGHT, borderRadius: RADII.pill, backgroundColor: '#FFFFFF',
  },
});

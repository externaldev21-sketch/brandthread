/**
 * TabBarGlassZone — frosted-glass-over-live-content treatment for the strip
 * of screen that sits behind a floating tab bar.
 *
 * Replaces the old "blur a static poster copy" trick (PR #196's
 * BottomStripBlur) that the owner rejected for reading as a dead gray band:
 * this component does NOT render a mirrored/duplicated copy of whatever is
 * behind it. It is a thin, mostly-transparent overlay meant to sit ON TOP of
 * content that is already rendered full-bleed underneath it (video, a
 * SectionList/FlatList, etc) so the platform's own real blur — CSS
 * `backdrop-filter` on web, a native blur material on iOS/Android — samples
 * whatever is actually behind it in real time. As that content moves
 * (a playing video, a scrolling list), the blur updates automatically,
 * because it's a genuine backdrop sample, not a second rendering of the
 * content.
 *
 * The top edge is feathered (not a hard seam): a gradient mask on web
 * (`mask-image`), and a short run of stacked, ramping-intensity blur bands
 * on native (there's no CSS-style alpha mask readily available for a native
 * blur view in this app without pulling in @react-native-masked-view, so a
 * few thin bands whose blur intensity ramps from ~0 to full approximates the
 * same soft transition — adjacent bands' own blur radii overlap enough that
 * the eye doesn't read discrete steps).
 *
 * Used by every buyer/seller screen that shows content full-bleed behind the
 * floating tab bar: the feed's video, and any list screen (Activity,
 * Orders, …) that used to have a hard dark scrim there instead.
 *
 * Reuses the app's shared `<Glass/>` primitive (components/ui/Glass.tsx,
 * from the Liquid Glass sweep) for its solid full-intensity body — same
 * native GlassView/BlurView selection, same Android blur method, so this
 * strip's material matches every other glass surface in the app. `Glass`
 * itself has no partial-intensity or masking API (it's a fixed-material
 * pill/panel primitive), so the feathered top edge — this component's own
 * job — stays hand-rolled here: a real CSS mask on web, and a short run of
 * stacked, ramping-intensity `BlurView` bands on native approximating the
 * same soft ramp (there's no cheap alpha-mask for a native blur view without
 * pulling in @react-native-masked-view). Kept as its own component, not
 * inlined per screen, so it stays a single place to later fold into `Glass`
 * itself if that primitive grows mask/intensity support.
 */
import React from 'react';
import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Glass } from '@/components/ui/Glass';

export interface TabBarGlassZoneProps {
  /** Height of the glass strip, in points — normally the tab bar's `barTopInset`. */
  height: number;
  /** Width of the strip. Required on web/native alike for the mask/gradient math. */
  width: number;
  /** 'dark' (default) reads over photo/video backdrops; 'light' for bright list surfaces. */
  tint?: 'dark' | 'light';
  /** How far the blur/tint feathers in from the top edge, in points. */
  featherHeight?: number;
  style?: ViewStyle;
}

// Feather ramp: intensity fractions applied across `featherHeight`, thinnest
// (least blurred) at the top so the transition from sharp content to full
// blur reads as continuous rather than a visible line.
const FEATHER_STEPS = [0.08, 0.22, 0.4, 0.6, 0.8, 1] as const;

const TINT_RGB: Record<'dark' | 'light', string> = {
  dark: '10,10,11',
  light: '255,255,255',
};

export function TabBarGlassZone({ height, width, tint = 'dark', featherHeight = 28, style }: TabBarGlassZoneProps) {
  if (height <= 0) return null;
  const clampedFeather = Math.min(featherHeight, height);

  if (Platform.OS === 'web') {
    return <WebGlassZone height={height} width={width} tint={tint} featherHeight={clampedFeather} style={style} />;
  }
  return <NativeGlassZone height={height} width={width} tint={tint} featherHeight={clampedFeather} style={style} />;
}

function WebGlassZone({ height, width, tint, featherHeight, style }: Required<Omit<TabBarGlassZoneProps, 'style'>> & { style?: ViewStyle }) {
  const rgb = TINT_RGB[tint];
  // `mask-image`/`-webkit-mask-image` feathers the whole layer (blur + tint
  // together) in one real alpha gradient — no stepping needed on web.
  //
  // Eased stops, not a straight 2-point linear ramp: alpha-compositing a
  // strong (24px) blur is perceptually nonlinear — even a modest mask alpha
  // already mixes in enough of the blurred layer to visibly soften fine
  // detail, so a plain 0%→100% linear ramp reads as blur "switching on"
  // within the first few px of the feather rather than easing in across all
  // of it. Slowing the first half of the ramp (and only reaching full alpha
  // at the very end) spreads the perceived transition across the whole
  // feather band instead.
  const f = featherHeight;
  const maskImage = `linear-gradient(to bottom, ` +
    `rgba(0,0,0,0) 0px, ` +
    `rgba(0,0,0,0.12) ${Math.round(f * 0.35)}px, ` +
    `rgba(0,0,0,0.4) ${Math.round(f * 0.6)}px, ` +
    `rgba(0,0,0,0.75) ${Math.round(f * 0.82)}px, ` +
    `rgba(0,0,0,1) ${f}px, ` +
    `rgba(0,0,0,1) 100%)`;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { height, width },
        style,
        // Cast: these are real CSS properties react-native-web forwards
        // (and prefixes) for web, but aren't in RN's ViewStyle type.
        {
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          maskImage,
          WebkitMaskImage: maskImage,
        } as unknown as ViewStyle,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(${rgb},${tint === 'dark' ? 0.22 : 0.4})` }]} />
    </View>
  );
}

function NativeGlassZone({ height, width, tint, featherHeight, style }: Required<Omit<TabBarGlassZoneProps, 'style'>> & { style?: ViewStyle }) {
  const rgb = TINT_RGB[tint];
  const bodyHeight = Math.max(0, height - featherHeight);
  const stepHeight = featherHeight / FEATHER_STEPS.length;
  return (
    <View pointerEvents="none" style={[styles.wrap, { height, width }, style]}>
      {/* Feather zone: thin ramping-intensity bands, top edge softest. */}
      {FEATHER_STEPS.map((fraction, i) => (
        <NativeBlurBand
          key={i}
          tint={tint}
          intensity={Math.round(fraction * 85)}
          style={{
            position: 'absolute',
            top: i * stepHeight,
            left: 0,
            width,
            height: featherHeight - i * stepHeight + bodyHeight,
          }}
        />
      ))}
      {/* Body zone: the shared Glass primitive at full strength — same
          material (GlassView on iOS 26+, BlurView elsewhere) as every other
          glass surface in the app. */}
      {bodyHeight > 0 && (
        <Glass
          variant="regular"
          tint={tint}
          radius={0}
          pointerEvents="none"
          style={{ position: 'absolute', top: featherHeight, left: 0, width, height: bodyHeight }}
        />
      )}
      {/* Light color wash on top — real LinearGradient, so this part of the
          feather (the tint, not the blur) is a genuine smooth alpha ramp. */}
      <LinearGradient
        pointerEvents="none"
        colors={[`rgba(${rgb},0)`, `rgba(${rgb},${tint === 'dark' ? 0.24 : 0.42})`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[0, Math.min(1, featherHeight / height)]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * One feather-ramp blur band. Lazily requires `expo-blur` at first render
 * (matches `Glass`'s own lazy require) so a screen that never mounts this
 * zone doesn't pull the native blur module in.
 *
 * `blurMethod: 'dimezisBlurViewSdk31Plus'` on Android — the same real-blur
 * attempt `Glass` itself makes on SDK 31+, falling back to `BlurView`'s own
 * built-in semi-transparent-view behavior below that (see `BlurMethod`'s
 * doc in expo-blur's types) rather than a hand-rolled flat tint here.
 */
function NativeBlurBand({ style, intensity, tint }: { style: ViewStyle; intensity: number; tint: 'dark' | 'light' }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BlurView } = require('expo-blur') as typeof import('expo-blur');
    return (
      <BlurView
        intensity={intensity}
        tint={tint}
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
        style={style}
      />
    );
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});

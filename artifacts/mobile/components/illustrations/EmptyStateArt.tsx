/**
 * EmptyStateArt — one cohesive set of monochrome line illustrations for empty
 * states app-wide, built around Brandthread's thread/needle motif: each
 * object is drawn as a single continuous stroked path (or two threads
 * meeting), never a filled icon-in-a-box.
 *
 * Canvas is always a 160×160 viewBox so every motif shares the same stroke
 * weight and proportions regardless of the render size a screen asks for.
 * Draw-on is optional, plays once, and is skipped entirely under Reduce
 * Motion (checked once per mount — no context dependency, so this works
 * anywhere an empty state can appear).
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

export type ThreadMotif =
  | 'hanger'
  | 'spool'
  | 'friends'
  | 'search'
  | 'trending'
  | 'envelope'
  | 'bell'
  | 'tee'
  | 'bookmark'
  | 'heart';

// Deferred until the first illustration actually renders: many screens pull
// in EmptyState without ever passing `illustration`, and their tests mock
// react-native-svg/-reanimated with only the exports their own screen needs.
// Touching `Path`/`Animated.createAnimatedComponent` at module scope would
// force every one of those mocks to also stub this component's exports.
let AnimatedPathComponent: React.ComponentType<any> | undefined;
function getAnimatedPath() {
  if (!AnimatedPathComponent) AnimatedPathComponent = Animated.createAnimatedComponent(Path);
  return AnimatedPathComponent;
}

// One continuous-thread path per motif, drawn in a shared 160×160 box.
const PATHS: Record<ThreadMotif, string> = {
  hanger: 'M74,28 C74,18 86,18 86,28 C86,36 80,38 80,44 L80,56 M80,56 L34,112 L126,112 L80,56',
  spool: 'M55,50 A25,10 0 0 0 105,50 L105,110 A25,10 0 0 1 55,110 Z M55,50 A25,10 0 0 1 105,50 M62,66 L98,94 M62,94 L98,66 M100,118 C110,125 118,115 112,108',
  friends: 'M35,100 C35,82 65,82 65,100 M95,100 C95,82 125,82 125,100 M58,78 Q80,62 102,78',
  search: 'M68,36 A32,32 0 1,0 68,100 A32,32 0 1,0 68,36 M92,92 L120,120 M120,120 C126,114 132,122 126,128',
  trending: 'M25,100 L48,100 L62,66 L78,116 L94,50 C99,35 89,28 94,18 C101,26 107,34 99,48 L110,100 L135,100',
  envelope: 'M30,55 L130,55 L130,115 L30,115 Z M30,55 L80,90 L130,55',
  bell: 'M80,28 C80,24 84,24 84,28 C104,32 112,52 112,72 L118,96 L46,96 L52,72 C52,52 60,32 80,28 Z M70,102 A10,8 0 0,0 94,102',
  tee: 'M50,45 L70,45 L80,55 L90,45 L110,45 L112,62 L100,68 L100,122 L60,122 L60,68 L48,62 Z',
  bookmark: 'M50,28 L110,28 L110,132 L80,106 L50,132 Z',
  heart: 'M80,116 C40,86 30,60 30,45 C30,25 55,20 65,35 C70,42 75,50 80,58 C85,50 90,42 95,35 C105,20 130,25 130,45 C130,60 120,86 80,116 Z',
};

// Generously exceeds every motif's real path length, so at offset 0 the
// "dash on" segment fully covers the visible path.
const DASH_LEN = 640;

export function ThreadIllustration({
  motif,
  size = 64,
  color = '#FFFFFF',
  strokeWidth = 4,
  animated = true,
  style,
}: {
  motif: ThreadMotif;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Plays a 600ms draw-on stroke once; ignored under Reduce Motion. */
  animated?: boolean;
  style?: object;
}) {
  const progress = useSharedValue(animated ? 0 : 1);
  const started = useRef(false);

  useEffect(() => {
    if (!animated || started.current) return;
    started.current = true;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) {
        progress.value = 1;
        return;
      }
      progress.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    });
    return () => { cancelled = true; cancelAnimation(progress); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: DASH_LEN * (1 - progress.value),
  }));
  const AnimatedPath = getAnimatedPath();

  return (
    <Svg width={size} height={size} viewBox="0 0 160 160" style={style} accessibilityElementsHidden>
      <AnimatedPath
        d={PATHS[motif]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={[DASH_LEN, DASH_LEN]}
        animatedProps={animatedProps}
      />
      {motif === 'friends' && (
        <>
          <Circle cx={50} cy={68} r={9} stroke={color} strokeWidth={strokeWidth} fill="none" />
          <Circle cx={110} cy={68} r={9} stroke={color} strokeWidth={strokeWidth} fill="none" />
        </>
      )}
    </Svg>
  );
}

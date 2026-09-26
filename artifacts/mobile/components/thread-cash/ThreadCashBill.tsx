/**
 * Thread Cash visual identity — the currency art the owner designed: a
 * green dollar-style bill with a chrome "B" in a medallion, "THREAD CASH"
 * wordmarks, a "B" in each corner, wireframe globes, and 4-point sparkles,
 * plus a round coin crop of the "B" medallion.
 *
 * <ThreadCashBill/> renders the flat bill (~600x255). Metro can't
 * conditionally `require()` an asset that doesn't exist yet, so until
 * artifacts/mobile/assets/thread-cash/thread-cash-bill.png lands, this is a
 * faithful react-native-svg recreation in the same greens. Once that PNG is
 * added, swap the body of ThreadCashBill for an <Image source={require(...)}
 * /> — everywhere in the app that renders <ThreadCashBill/> picks it up for
 * free, no caller changes needed.
 *
 * <ThreadCashCoin/> renders the existing coin PNG
 * (assets/thread-cash/thread-cash-coin.png, already on dev).
 */
import React from 'react';
import { Image, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
  Path,
  Text as SvgText,
  G,
} from 'react-native-svg';

export const THREAD_CASH_GREEN_DEEP = '#1E7A2E';
export const THREAD_CASH_GREEN_MID = '#3DBE4F';
export const THREAD_CASH_GREEN_PAPER = '#CFEFC8';

const BILL_ASPECT = 600 / 255;

function Sparkle({ x, y, size, opacity = 0.85 }: { x: number; y: number; size: number; opacity?: number }) {
  // A simple 4-point sparkle: two crossed diamonds of different length.
  const s = size;
  return (
    <G opacity={opacity} transform={`translate(${x}, ${y})`}>
      <Path
        d={`M 0 ${-s} L ${s * 0.22} ${-s * 0.22} L ${s} 0 L ${s * 0.22} ${s * 0.22} L 0 ${s} L ${-s * 0.22} ${s * 0.22} L ${-s} 0 L ${-s * 0.22} ${-s * 0.22} Z`}
        fill="#FFFFFF"
      />
    </G>
  );
}

function WireGlobe({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <G transform={`translate(${x}, ${y})`} opacity={0.35}>
      <Circle cx={0} cy={0} r={r} stroke="#FFFFFF" strokeWidth={0.8} fill="none" />
      <Path d={`M ${-r} 0 A ${r} ${r * 0.35} 0 0 0 ${r} 0`} stroke="#FFFFFF" strokeWidth={0.6} fill="none" />
      <Path d={`M ${-r} 0 A ${r} ${r * 0.35} 0 0 1 ${r} 0`} stroke="#FFFFFF" strokeWidth={0.6} fill="none" />
      <Path d={`M 0 ${-r} L 0 ${r}`} stroke="#FFFFFF" strokeWidth={0.6} fill="none" />
      <Path d={`M ${-r * 0.7} ${-r * 0.7} L ${r * 0.7} ${r * 0.7}`} stroke="#FFFFFF" strokeWidth={0.5} fill="none" />
    </G>
  );
}

function CornerBadge({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  return (
    <G transform={`translate(${x}, ${y}) ${flip ? 'rotate(180)' : ''}`}>
      <Circle cx={0} cy={0} r={13} fill={THREAD_CASH_GREEN_DEEP} stroke="#FFFFFF" strokeWidth={1} />
      <SvgText x={0} y={5} fontSize={16} fontWeight="800" fill="#E9F7E6" textAnchor="middle">B</SvgText>
    </G>
  );
}

/** The flat bill: rounded green border, paper panel, medallion, wordmarks. */
export function ThreadCashBill({
  width = 220,
  style,
}: {
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const height = width / BILL_ASPECT;
  const w = 600;
  const h = 255;

  return (
    <View style={[{ width, height }, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <LinearGradient id="borderGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={THREAD_CASH_GREEN_MID} />
            <Stop offset="1" stopColor={THREAD_CASH_GREEN_DEEP} />
          </LinearGradient>
          <RadialGradient id="medallionGrad" cx="0.4" cy="0.35" r="0.75">
            <Stop offset="0" stopColor={THREAD_CASH_GREEN_MID} />
            <Stop offset="1" stopColor={THREAD_CASH_GREEN_DEEP} />
          </RadialGradient>
          <LinearGradient id="chromeB" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.45" stopColor="#CFEFD6" />
            <Stop offset="0.55" stopColor="#8FBF9A" />
            <Stop offset="1" stopColor="#FFFFFF" />
          </LinearGradient>
        </Defs>

        {/* Outer rounded green border */}
        <Rect x={2} y={2} width={w - 4} height={h - 4} rx={18} fill="url(#borderGrad)" />
        {/* Paper inner panel */}
        <Rect x={14} y={14} width={w - 28} height={h - 28} rx={12} fill={THREAD_CASH_GREEN_PAPER} stroke={THREAD_CASH_GREEN_DEEP} strokeWidth={1.5} />

        {/* Wireframe globes, faint, either side of the medallion */}
        <WireGlobe x={110} y={80} r={38} />
        <WireGlobe x={w - 110} y={h - 80} r={38} />

        {/* Corner B badges */}
        <CornerBadge x={40} y={40} />
        <CornerBadge x={w - 40} y={40} flip />
        <CornerBadge x={40} y={h - 40} flip />
        <CornerBadge x={w - 40} y={h - 40} />

        {/* THREAD CASH wordmarks, top-left and bottom-right (rotated) */}
        <G transform="translate(70, 46)">
          <SvgText x={0} y={0} fontSize={15} fontWeight="800" letterSpacing={1.5} fill={THREAD_CASH_GREEN_DEEP}>THREAD</SvgText>
          <SvgText x={0} y={17} fontSize={15} fontWeight="800" letterSpacing={1.5} fill={THREAD_CASH_GREEN_DEEP}>CASH</SvgText>
        </G>
        <G transform={`translate(${w - 70}, ${h - 46}) rotate(180)`}>
          <SvgText x={0} y={0} fontSize={15} fontWeight="800" letterSpacing={1.5} fill={THREAD_CASH_GREEN_DEEP} textAnchor="end">THREAD</SvgText>
          <SvgText x={0} y={17} fontSize={15} fontWeight="800" letterSpacing={1.5} fill={THREAD_CASH_GREEN_DEEP} textAnchor="end">CASH</SvgText>
        </G>

        {/* Center medallion with chrome B */}
        <Circle cx={w / 2} cy={h / 2} r={64} fill="url(#medallionGrad)" stroke={THREAD_CASH_GREEN_DEEP} strokeWidth={2.5} />
        <Circle cx={w / 2} cy={h / 2} r={54} fill="none" stroke="#FFFFFF" strokeOpacity={0.4} strokeWidth={1.2} strokeDasharray="3 4" />
        <SvgText
          x={w / 2}
          y={h / 2 + 28}
          fontSize={82}
          fontWeight="900"
          fill="url(#chromeB)"
          stroke={THREAD_CASH_GREEN_DEEP}
          strokeWidth={1.5}
          textAnchor="middle"
        >
          B
        </SvgText>

        {/* Sparkles */}
        <Sparkle x={200} y={50} size={7} />
        <Sparkle x={w - 200} y={h - 50} size={7} />
        <Sparkle x={w / 2 - 90} y={h / 2 - 60} size={5} opacity={0.7} />
        <Sparkle x={w / 2 + 95} y={h / 2 + 55} size={5} opacity={0.7} />
        <Sparkle x={95} y={h - 90} size={5} opacity={0.6} />
        <Sparkle x={w - 95} y={90} size={5} opacity={0.6} />
      </Svg>
    </View>
  );
}

/** The round coin crop of the "B" medallion, from the shipped PNG. */
export function ThreadCashCoin({
  size = 24,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../assets/thread-cash/thread-cash-coin.png')}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

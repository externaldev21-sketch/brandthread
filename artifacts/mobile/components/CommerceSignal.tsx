/**
 * CommerceSignal — buyer-only demand layer primitives.
 *
 * All signals are truthful: they render only when the server-supplied field is
 * present and non-zero. No mock values, no fabricated totals.
 *
 * Urgency accent is the app's signature theme.accent color — the single
 * system-wide signal color for low stock, ending-soon, live, and high-demand
 * states. RED is reserved exclusively for destructive/error semantics
 * (delete, payment failures). Every primitive accepts an optional `accent`
 * prop so callers can pass the runtime theme.accent value; they default to
 * useAppTheme() internally.
 *
 * Reduced-motion: all Animated.loop pulses are guarded by AccessibilityInfo.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BORDER,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Almost sold out: remaining units at or below this triggers urgency accent. */
export const URGENCY_UNITS_THRESHOLD = 10;

/** Ending soon: minutes remaining at or below this triggers urgency accent. */
export const URGENCY_MINUTES_THRESHOLD = 60;

/** High demand: demandCount at or above this shows the high-demand badge. */
export const HIGH_DEMAND_THRESHOLD = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** Format seconds-remaining as "HH:MM:SS" or "MM:SS" */
function formatSecondsRemaining(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

/** Return seconds until isoDate, or null if absent/past. */
function secondsUntil(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const diff = Math.floor((new Date(isoDate).getTime() - Date.now()) / 1000);
  return diff > 0 ? diff : null;
}

// ─── Live pulse dot ───────────────────────────────────────────────────────────
// Pulses using the urgency accent color (theme.accent by default).

interface LivePulseDotProps {
  /** Urgency accent color — pass theme.accent at callsite. Defaults to theme.accent via hook. */
  color?: string;
}

export function LivePulseDot({ color }: LivePulseDotProps) {
  const { theme } = useAppTheme();
  const dotColor = color ?? theme.accent;
  const scale = useRef(new Animated.Value(1)).current;
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.7, duration: 750, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, reducedMotion]);

  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      {!reducedMotion && (
        <Animated.View
          style={{
            position: 'absolute',
            width: 10, height: 10, borderRadius: 5,
            backgroundColor: dotColor,
            opacity: 0.3,
            transform: [{ scale }],
          }}
        />
      )}
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />
    </View>
  );
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

/**
 * Counts down from endsAt in 1-second ticks.
 * Returns null when endsAt is absent or already passed.
 */
export function useSecondsRemaining(endsAt: string | null | undefined): number | null {
  const [secs, setSecs] = useState<number | null>(() => secondsUntil(endsAt));

  useEffect(() => {
    const initial = secondsUntil(endsAt);
    setSecs(initial);
    if (initial === null) return;
    const id = setInterval(() => {
      setSecs(prev => {
        if (prev === null || prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return secs;
}

// ─── ClaimedRemainingLabel ─────────────────────────────────────────────────────
// "42 claimed · 58 left" — omitted entirely when both are zero/absent.
// When urgent, the remaining portion renders in the urgency accent (theme.accent).

interface ClaimedRemainingProps {
  claimedUnits: number;
  remainingUnits: number;
  /** When true the remaining portion uses the urgency accent instead of MUTED */
  urgent?: boolean;
  /**
   * Urgency accent color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function ClaimedRemainingLabel({
  claimedUnits,
  remainingUnits,
  urgent,
  accent,
  style,
}: ClaimedRemainingProps) {
  const { theme } = useAppTheme();
  const urgentColor = accent ?? theme.accent;

  const hasClaimed   = claimedUnits   > 0;
  const hasRemaining = remainingUnits > 0;
  if (!hasClaimed && !hasRemaining) return null;

  return (
    <View style={[sig.row, style]}>
      {hasClaimed && (
        <Text style={[sig.labelBase, { color: MUTED }]}>
          {claimedUnits.toLocaleString()} claimed
        </Text>
      )}
      {hasClaimed && hasRemaining && (
        <Text style={[sig.sep, { color: SUBTLE }]}> · </Text>
      )}
      {hasRemaining && (
        <Text style={[sig.labelBase, urgent ? { color: urgentColor } : { color: MUTED }]}>
          {remainingUnits.toLocaleString()} left
        </Text>
      )}
    </View>
  );
}

// ─── TimeRemainingLabel ────────────────────────────────────────────────────────
// Renders "HH:MM:SS" — hidden when endsAt absent or passed.
// Ending-soon state uses the urgency accent (theme.accent), not RED.

interface TimeRemainingProps {
  endsAt: string | null | undefined;
  /**
   * Urgency accent color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function TimeRemainingLabel({ endsAt, accent, style }: TimeRemainingProps) {
  const { theme } = useAppTheme();
  const urgentColor = accent ?? theme.accent;

  const secs = useSecondsRemaining(endsAt);
  if (secs === null || secs <= 0) return null;

  const isUrgent = secs <= URGENCY_MINUTES_THRESHOLD * 60;
  // Non-urgent: MUTED; urgent: signature accent
  const color = isUrgent ? urgentColor : MUTED;

  return (
    <View style={[sig.row, style]}>
      {isUrgent && <LivePulseDot color={urgentColor} />}
      {!isUrgent && <Feather name="clock" size={11} color={color} />}
      <Text style={[sig.labelBase, { color, marginLeft: 4, fontVariant: ['tabular-nums'] }]}>
        {formatSecondsRemaining(secs)}
      </Text>
    </View>
  );
}

// ─── UrgencyBar ───────────────────────────────────────────────────────────────
// A 2px stock-fill bar — only rendered when remainingUnits > 0 AND claimedUnits > 0.
// Fills with the urgency accent color (theme.accent) at any stock level.
// Low-stock state keeps the same accent — intensity comes from the label, not a color change.

interface UrgencyBarProps {
  claimedUnits: number;
  remainingUnits: number;
  /**
   * Fill color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function UrgencyBar({
  claimedUnits,
  remainingUnits,
  accentColor,
  style,
}: UrgencyBarProps) {
  const { theme } = useAppTheme();
  if (claimedUnits <= 0 || remainingUnits <= 0) return null;

  const total   = claimedUnits + remainingUnits;
  const soldPct = Math.max(0, Math.min(100, Math.round((claimedUnits / total) * 100)));
  // Always use the signature accent — theme.accent is the urgency signal color
  const barColor = accentColor ?? theme.accent;

  return (
    <View style={[sig.barTrack, style]}>
      <View style={[sig.barFill, { width: `${soldPct}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

// ─── DemandBadge ──────────────────────────────────────────────────────────────
// "High Demand" — shown when demandCount >= HIGH_DEMAND_THRESHOLD.
// Uses the urgency accent (theme.accent), not RED.

interface DemandBadgeProps {
  demandCount: number | null | undefined;
  /**
   * Badge accent color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function DemandBadge({ demandCount, accent, style }: DemandBadgeProps) {
  const { theme } = useAppTheme();
  const badgeAccent = accent ?? theme.accent;
  const badgeDim = theme.accentDim ?? `${badgeAccent}22`;

  if (!demandCount || demandCount < HIGH_DEMAND_THRESHOLD) return null;
  return (
    <View style={[sig.demandBadge, { backgroundColor: badgeDim }, style]}>
      <Feather name="trending-up" size={10} color={badgeAccent} />
      <Text style={[sig.demandBadgeText, { color: badgeAccent }]}>High Demand</Text>
    </View>
  );
}

// ─── PriceBadge ───────────────────────────────────────────────────────────────
// Displays currentPriceCents from the public projection.

interface PriceBadgeProps {
  currentPriceCents: number | null | undefined;
  style?: StyleProp<TextStyle>;
}

export function PriceBadge({ currentPriceCents, style }: PriceBadgeProps) {
  if (currentPriceCents === null || currentPriceCents === undefined) return null;
  return (
    <Text style={[sig.price, style]}>{formatCents(currentPriceCents)}</Text>
  );
}

// ─── CommerceSignalRow ─────────────────────────────────────────────────────────
// Composes the full buyer demand signal row: price, units, time, demand badge.
// Every field is conditional — absent server data produces no output.
// All urgency uses the signature theme.accent — pass accent from callsite.

export interface CommerceSignalData {
  currentPriceCents?: number | null;
  claimedUnits?:      number;
  remainingUnits?:    number;
  demandCount?:       number | null;
  endsAt?:            string | null;
}

interface CommerceSignalRowProps extends CommerceSignalData {
  /** Show the price prominently at the start */
  showPrice?: boolean;
  /**
   * Urgency accent color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function CommerceSignalRow({
  currentPriceCents,
  claimedUnits     = 0,
  remainingUnits   = 0,
  demandCount,
  endsAt,
  showPrice,
  accent,
  style,
}: CommerceSignalRowProps) {
  const { theme } = useAppTheme();
  const urgentColor = accent ?? theme.accent;

  const isUrgent =
    (remainingUnits > 0 && remainingUnits <= URGENCY_UNITS_THRESHOLD) ||
    (!!demandCount && demandCount >= HIGH_DEMAND_THRESHOLD);

  const hasSignal =
    (showPrice && currentPriceCents != null) ||
    claimedUnits  > 0 ||
    remainingUnits > 0 ||
    !!demandCount  ||
    !!endsAt;

  if (!hasSignal) return null;

  return (
    <View style={[sig.signalRow, style]}>
      {showPrice && currentPriceCents != null && (
        <PriceBadge currentPriceCents={currentPriceCents} />
      )}
      <ClaimedRemainingLabel
        claimedUnits={claimedUnits}
        remainingUnits={remainingUnits}
        urgent={isUrgent}
        accent={urgentColor}
      />
      {!!endsAt && (
        <View style={{ marginLeft: claimedUnits > 0 || remainingUnits > 0 ? SP.sm : 0 }}>
          <TimeRemainingLabel endsAt={endsAt} accent={urgentColor} />
        </View>
      )}
      {isUrgent && <DemandBadge demandCount={demandCount} accent={urgentColor} style={{ marginLeft: SP.xs }} />}
    </View>
  );
}

// ─── HighDemandSectionHead ────────────────────────────────────────────────────
// Bold headline + short subtext for the high-demand / trending section.
// The icon uses the urgency accent (theme.accent).

interface HighDemandSectionHeadProps {
  title?: string;
  subtitle?: string;
  /**
   * Icon + accent color — pass theme.accent from the callsite.
   * Falls back to theme.accent via internal hook when omitted.
   */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

export function HighDemandSectionHead({
  title    = 'High Demand',
  subtitle = 'Moving fast across the platform right now',
  accent,
  style,
}: HighDemandSectionHeadProps) {
  const { theme } = useAppTheme();
  const iconColor = accent ?? theme.accent;
  const iconDim   = theme.accentDim ?? `${iconColor}22`;

  return (
    <View style={[hd.root, style]}>
      <View style={[hd.iconWrap, { backgroundColor: iconDim }]}>
        <Feather name="trending-up" size={14} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={hd.title}>{title}</Text>
        {!!subtitle && <Text style={hd.sub}>{subtitle}</Text>}
      </View>
    </View>
  );
}

const hd = StyleSheet.create({
  root:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 14 },
  iconWrap:{ width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: 20, fontFamily: FONT.bold, color: FG, letterSpacing: -0.4, lineHeight: 24 },
  sub:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
});

// ─── UpcomingCountdown ────────────────────────────────────────────────────────
// Counts down to releaseAt for upcoming drops.

interface UpcomingCountdownProps {
  releaseAt: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}

export function UpcomingCountdown({ releaseAt, style }: UpcomingCountdownProps) {
  const secs = useSecondsRemaining(releaseAt);
  if (secs === null || secs <= 0) return null;

  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins  = Math.floor((secs % 3600) / 60);
  const s     = secs % 60;

  const units = days > 0
    ? [{ label: 'D', v: days }, { label: 'H', v: hours }, { label: 'M', v: mins }]
    : [{ label: 'H', v: hours }, { label: 'M', v: mins }, { label: 'S', v: s }];

  return (
    <View style={[uc.row, style]}>
      {units.map(({ label, v }, i) => (
        <React.Fragment key={label}>
          {i > 0 && <Text style={uc.colon}>:</Text>}
          <View style={uc.block}>
            <Text style={[uc.num, { fontVariant: ['tabular-nums'] }]}>{pad2(v)}</Text>
            <Text style={uc.lbl}>{label}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const uc = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  colon: { fontSize: FS.md, fontFamily: FONT.semibold, color: MUTED, marginBottom: 8, paddingHorizontal: 1 },
  block: { alignItems: 'center', minWidth: 36 },
  num:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG, letterSpacing: -0.5 },
  lbl:   { fontSize: 9, fontFamily: FONT.semibold, color: SUBTLE, letterSpacing: 1, marginTop: 1 },
});

// ─── Shared styles ────────────────────────────────────────────────────────────

const sig = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center' },
  sep:    { fontSize: FS.xs, fontFamily: FONT.regular },
  labelBase: { fontSize: FS.xs, fontFamily: FONT.medium },
  barTrack: { height: 2, backgroundColor: BORDER, borderRadius: 1, overflow: 'hidden' },
  barFill:  { height: 2, borderRadius: 1 },
  demandBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: RADIUS.pill,
  },
  demandBadgeText: { fontSize: 9, fontFamily: FONT.bold, letterSpacing: 0.3 },
  price: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  signalRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.xs },
});

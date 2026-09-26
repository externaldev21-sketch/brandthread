/**
 * AnalyticsKit — shared building blocks for every seller Analytics screen.
 *
 * All color comes from useColors()/useAppTheme() at render time so every
 * screen built from this kit re-skins correctly across all 12 monochrome
 * theme presets. Never import raw color constants (FG, MUTED, BORDER,
 * PURPLE, SUCCESS, RED, CARD, …) from `@/lib/theme` here or in a screen that
 * uses this kit — only the static spacing/size tokens (SP, RADIUS, FONT, FS)
 * are safe to keep static.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

type Colors = ReturnType<typeof useColors>;

// ─── Header ─────────────────────────────────────────────────────────────────

export function AnalyticsHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const colors = useColors();
  const router = useRouter();
  const s = useMemo(() => headerStyles(colors), [colors]);
  return (
    <View style={s.root}>
      <TouchableOpacity
        onPress={() => { Haptics.selectionAsync(); (onBack ?? router.back)(); }}
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="arrow-left" size={20} color={colors.foreground} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const headerStyles = (colors: Colors) => StyleSheet.create({
  root:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.lg },
  backBtn:  { width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: RADIUS.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: FS.xl, fontFamily: FONT.bold, color: colors.foreground, letterSpacing: -0.3 },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground, marginTop: 1 },
});

/** Small pill button for a header's trailing slot (e.g. "Edit Store", "Mfr. Hub"). */
export function HeaderPillButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  const s = useMemo(() => pillBtnStyles(colors), [colors]);
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={s.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.text}>{label}</Text>
    </TouchableOpacity>
  );
}
const pillBtnStyles = (colors: Colors) => StyleSheet.create({
  btn:  { paddingHorizontal: SP.sm + 4, paddingVertical: SP.sm - 1, minHeight: 36, borderRadius: RADIUS.pill, backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: FS.xs, fontFamily: FONT.semibold, color: colors.accentForeground },
});

// ─── Section ────────────────────────────────────────────────────────────────

export function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: SP.sm }}>
      <Text style={{ fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground }}>{children}</Text>
      {!!note && <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: 2 }}>{note}</Text>}
    </View>
  );
}

export function Card({ children, style, padded = false }: { children: React.ReactNode; style?: any; padded?: boolean }) {
  const colors = useColors();
  return (
    <View style={[{
      backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border,
      marginBottom: SP.lg, overflow: 'hidden',
    }, padded && { padding: SP.md }, style]}>
      {children}
    </View>
  );
}

export function CardDivider() {
  const colors = useColors();
  return <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: SP.md }} />;
}

// ─── Pill tabs (chart-series switcher, sort pills, list filters) ────────────

export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  scroll = true,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  scroll?: boolean;
}) {
  const colors = useColors();
  const s = useMemo(() => pillTabStyles(colors), [colors]);
  const content = (
    <View style={{ flexDirection: 'row', gap: SP.xs, flexWrap: scroll ? 'nowrap' : 'wrap' }}>
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => { Haptics.selectionAsync(); onChange(opt.key); }}
            style={[s.pill, active && s.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.pillText, active && s.pillTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
  if (!scroll) return <View style={{ marginBottom: SP.md }}>{content}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.md }} contentContainerStyle={{ paddingRight: SP.md }}>
      {content}
    </ScrollView>
  );
}
const pillTabStyles = (colors: Colors) => StyleSheet.create({
  pill:       { minHeight: 36, paddingHorizontal: SP.sm + 2, paddingVertical: SP.xs, borderRadius: RADIUS.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.primary },
  pillText:     { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground },
  pillTextActive: { color: colors.accentForeground },
});

// ─── Trend chip (up/down arrow + %) ─────────────────────────────────────────

export function TrendChip({ changePct, invert = false, size = 'sm' }: { changePct?: number; invert?: boolean; size?: 'sm' | 'md' }) {
  const colors = useColors();
  if (!Number.isFinite(changePct)) return null;
  const pct = changePct as number;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const color = pct === 0 ? colors.mutedForeground : good ? colors.success : colors.destructive;
  const iconSize = size === 'md' ? 12 : 10;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {pct !== 0 && <Feather name={up ? 'arrow-up-right' : 'arrow-down-right'} size={iconSize} color={color} />}
      <Text style={{ fontSize: size === 'md' ? FS.xs + 1 : FS.xs, fontFamily: FONT.semibold, color }}>
        {up ? '+' : ''}{pct.toFixed(1)}%
      </Text>
    </View>
  );
}

// ─── StatTile / StatRow (KPI values with trend) ─────────────────────────────

export function StatTile({
  label, value, changePct, invert = false, featured = false, width,
}: {
  label: string; value: string; changePct?: number; invert?: boolean; featured?: boolean; width?: number;
}) {
  const colors = useColors();
  const s = useMemo(() => tileStyles(colors), [colors]);
  return (
    <View style={[s.tile, featured && s.tileFeatured, width ? { width } : { flex: 1 }]}>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      <Text
        style={[s.value, featured && { color: colors.primary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {Number.isFinite(changePct) && <TrendChip changePct={changePct} invert={invert} />}
    </View>
  );
}
const tileStyles = (colors: Colors) => StyleSheet.create({
  tile:         { backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, padding: SP.sm + 2, gap: 4, minWidth: 104 },
  tileFeatured: { backgroundColor: colors.elevated, borderColor: colors.primary + '33' },
  label:        { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground },
  value:        { fontSize: FS.lg, fontFamily: FONT.bold, color: colors.foreground },
});

/** Horizontal KPI strip — replaces each screen's ad hoc summaryRow/kpiGrid. */
export function StatTileRow({ items, scroll = false }: {
  items: { key: string; label: string; value: string; changePct?: number; invert?: boolean }[];
  scroll?: boolean;
}) {
  const row = (
    <View style={{ flexDirection: 'row', gap: SP.sm, flexWrap: scroll ? 'nowrap' : 'wrap', marginBottom: SP.lg }}>
      {items.map(it => (
        <StatTile key={it.key} label={it.label} value={it.value} changePct={it.changePct} invert={it.invert} width={scroll ? 128 : undefined} />
      ))}
    </View>
  );
  if (!scroll) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingRight: SP.md, marginBottom: SP.lg }}>
      {items.map(it => (
        <StatTile key={it.key} label={it.label} value={it.value} changePct={it.changePct} invert={it.invert} width={128} />
      ))}
    </ScrollView>
  );
}

/** A single labeled value row inside a Card — replaces per-screen StatRow/KpiRow/simpleRow. */
export function StatRow({
  label, value, changePct, invert = false, isDeduction = false, icon, iconColor,
}: {
  label: string; value: string; changePct?: number; invert?: boolean; isDeduction?: boolean;
  icon?: keyof typeof Feather.glyphMap; iconColor?: string;
}) {
  const colors = useColors();
  const s = useMemo(() => rowStyles(colors), [colors]);
  return (
    <View style={s.row}>
      {icon && (
        <View style={[s.icon, { backgroundColor: (iconColor ?? colors.primary) + '22' }]}>
          <Feather name={icon} size={14} color={iconColor ?? colors.primary} />
        </View>
      )}
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.value, isDeduction && { color: colors.destructive }]}>{isDeduction ? `−${value}` : value}</Text>
        <TrendChip changePct={changePct} invert={invert} />
      </View>
    </View>
  );
}
const rowStyles = (colors: Colors) => StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 1, minHeight: COMP.minTouchTarget, gap: SP.sm },
  icon:  { width: 30, height: 30, borderRadius: RADIUS.xs, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  value: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
});

// ─── Progress bar (sell-through, funnel steps, channel share) ──────────────

export function ProgressBar({ pct, color, height = 6 }: { pct: number; color?: string; height?: number }) {
  const colors = useColors();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ height, backgroundColor: colors.border, borderRadius: height / 2, overflow: 'hidden' }}>
      <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: color ?? colors.primary, borderRadius: height / 2 }} />
    </View>
  );
}

// ─── Bar chart (SVG) — replaces RevenueBarChart / MiniBar duplicated per screen ─

export interface ChartPoint { label: string; value: number; }

export function AnalyticsBarChart({
  points,
  color,
  height = 140,
  formatValue,
  emptyLabel = 'No data for this period',
}: {
  points: ChartPoint[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  emptyLabel?: string;
}) {
  const colors = useColors();
  const barColor = color ?? colors.primary;
  const [cardWidth, setCardWidth] = useState(0);
  const chartWidth = cardWidth > 0 ? cardWidth : 300;
  const labelHeight = 20;
  const gridHeight = height - labelHeight;
  const allZero = points.length === 0 || points.every(p => p.value === 0);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  const maxVal = allZero ? 0 : Math.max(...points.map(p => p.value));
  const levels = allZero ? [0] : niceLevels(maxVal);
  const topVal = levels[levels.length - 1] || 1;
  const yLabelW = 44;
  const plotW = chartWidth - yLabelW;
  const n = points.length;
  const barGap = n > 0 ? 2 : 0;
  const barW = n > 0 ? Math.max(3, (plotW - barGap * (n - 1)) / n) : 0;
  const barX = (i: number) => yLabelW + i * (barW + barGap);
  const barY = (value: number) => {
    if (topVal <= 0) return gridHeight;
    const frac = value / topVal;
    return gridHeight - Math.max(0, Math.min(1, frac)) * (gridHeight - 4);
  };

  return (
    <View onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={height}>
        {levels.map((v, i) => {
          const y = levels.length === 1 ? gridHeight : gridHeight - (i / (levels.length - 1)) * (gridHeight - 4);
          return (
            <React.Fragment key={i}>
              <Line x1={yLabelW} y1={y} x2={chartWidth} y2={y} stroke={colors.border} strokeWidth={1} />
              <SvgText x={yLabelW - 4} y={y + 4} textAnchor="end" fontSize={FS.xs} fontFamily={FONT.regular} fill={colors.subtle}>
                {fmt(v)}
              </SvgText>
            </React.Fragment>
          );
        })}
        {!allZero && points.map((p, i) => {
          if (p.value <= 0) return null;
          const x = barX(i);
          const y = barY(p.value);
          const h = gridHeight - y;
          return <Rect key={i} x={x} y={y} width={barW} height={Math.max(2, h)} rx={3} ry={3} fill={barColor} opacity={0.88} />;
        })}
        {points.length > 0 && (() => {
          const indices = points.length <= 7 ? points.map((_, i) => i) : [0, Math.floor((points.length - 1) / 2), points.length - 1];
          return indices.map(i => (
            <SvgText key={`lbl-${i}`} x={barX(i) + barW / 2} y={height - 2} textAnchor="middle" fontSize={FS.xs} fontFamily={FONT.regular} fill={colors.subtle}>
              {points[i].label}
            </SvgText>
          ));
        })()}
      </Svg>
      {allZero && (
        <View style={{ position: 'absolute', top: 0, left: yLabelW, right: 0, bottom: labelHeight, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.subtle }}>{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
}

function niceLevels(maxValue: number, steps = 4): number[] {
  const top = niceMax(maxValue);
  return Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));
}
function niceMax(maxValue: number): number {
  if (maxValue <= 0) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(maxValue)));
  return Math.ceil(maxValue / mag) * mag;
}

/** Compact inline sparkline for a row/tile — replaces per-screen MiniBar. */
export function Sparkline({ points, color, height = 28 }: { points: Array<{ value: number }>; color?: string; height?: number }) {
  const colors = useColors();
  const barColor = color ?? colors.primary;
  const max = Math.max(...points.map(p => p.value), 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 2 }}>
      {points.slice(-20).map((p, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (p.value / max) * height), backgroundColor: barColor, opacity: 0.75 }} />
      ))}
    </View>
  );
}

// ─── Skeleton loading state ─────────────────────────────────────────────────

function Shimmer({ width, height, radius = RADIUS.sm, style }: { width: number | `${number}%`; height: number; radius?: number; style?: any }) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: colors.elevated, opacity: pulse }, style]} />;
}

/**
 * Full-screen skeleton shaped like a typical analytics screen (header, KPI
 * strip, chart card, list card) — replaces every bare `ActivityIndicator`
 * loading state in this cluster.
 */
export function AnalyticsSkeleton({ topPad = 0, kpiCount = 3, listRows = 4 }: { topPad?: number; kpiCount?: number; listRows?: number }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: SP.md, paddingTop: topPad + SP.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.lg }}>
        <Shimmer width={COMP.iconBtn} height={COMP.iconBtn} radius={RADIUS.pill} />
        <View style={{ gap: 6 }}>
          <Shimmer width={160} height={20} radius={RADIUS.xs} />
          <Shimmer width={90} height={12} radius={RADIUS.xs} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg }}>
        {Array.from({ length: kpiCount }).map((_, i) => (
          <Shimmer key={i} width={0} height={72} radius={RADIUS.md} style={{ flex: 1 }} />
        ))}
      </View>
      <Shimmer width="100%" height={150} radius={RADIUS.md} style={{ marginBottom: SP.lg }} />
      <Shimmer width={120} height={16} radius={RADIUS.xs} style={{ marginBottom: SP.sm }} />
      <View style={{ gap: 1, borderRadius: RADIUS.md, overflow: 'hidden' }}>
        {Array.from({ length: listRows }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm + 2 }}>
            <Shimmer width={40} height={40} radius={RADIUS.sm} />
            <View style={{ flex: 1, gap: 6 }}>
              <Shimmer width="60%" height={13} radius={RADIUS.xs} />
              <Shimmer width="35%" height={11} radius={RADIUS.xs} />
            </View>
            <Shimmer width={48} height={20} radius={RADIUS.xs} />
          </View>
        ))}
      </View>
    </View>
  );
}

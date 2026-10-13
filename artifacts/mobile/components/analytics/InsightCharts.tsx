/**
 * Building blocks shared by the seller analytics reports — a 2-column KPI
 * grid with period-over-period deltas (TikTok Studio "Key metrics"), an SVG
 * area line chart bucketed like the Dashboard's (Shopify Analytics), and a
 * numbered ranked row with a thumbnail (TikTok Studio "Your top posts").
 * Every color comes from useColors() so all theme presets re-skin correctly.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Line, Path, Stop, Text as SvgText, Circle } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';
import { CachedImage } from '@/components/CachedImage';
import { TrendChip } from '@/components/analytics/AnalyticsKit';
import { bucketLabel, selectEvenlySpacedIndices } from '@/lib/sellerHomeChartLabels';
import type { InsightRange } from '@/services/sellerInsightsService';

type Colors = ReturnType<typeof useColors>;

/** "vs yesterday" style caption for a range's previous period; null for All. */
export function previousPeriodLabel(range: InsightRange): string | null {
  return { today: 'vs yesterday', week: 'vs last week', month: 'vs last month', year: 'vs last year', all: null }[range];
}

export interface KpiItem { key: string; label: string; value: string; changePct?: number | null; invert?: boolean; featured?: boolean; caption?: string }

/** Two tiles per row; the first can be featured (TikTok's highlighted "Post views" tile). */
export function KpiGrid({ items, range }: { items: KpiItem[]; range?: InsightRange }) {
  const colors = useColors();
  const s = React.useMemo(() => kpiStyles(colors), [colors]);
  const caption = range ? previousPeriodLabel(range) : null;
  const rows: KpiItem[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={{ marginBottom: SP.lg, gap: SP.sm }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: SP.sm }}>
          {row.map(it => (
            <View key={it.key} style={[s.tile, it.featured && s.tileFeatured]}>
              <Text style={s.label} numberOfLines={1}>{it.label}</Text>
              <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{it.value}</Text>
              <View style={s.deltaRow}>
                {typeof it.changePct === 'number' ? (
                  <>
                    <TrendChip changePct={it.changePct} invert={it.invert} />
                    {!!caption && <Text style={s.caption} numberOfLines={1}>{caption}</Text>}
                  </>
                ) : (
                  <Text style={s.deltaNone}>{it.caption ?? '—'}</Text>
                )}
              </View>
            </View>
          ))}
          {row.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}
const kpiStyles = (colors: Colors) => StyleSheet.create({
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, padding: SP.md, gap: 4, minHeight: 92 },
  tileFeatured: { borderColor: colors.primary },
  label: { fontSize: FS.meta, fontFamily: FONT.medium, color: colors.mutedForeground },
  value: { fontSize: FS.xl, fontFamily: FONT.bold, color: colors.foreground, letterSpacing: -0.3 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 16 },
  deltaNone: { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground },
  caption: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, flexShrink: 1 },
});

const AXIS_LABEL_COUNT: Record<InsightRange, number> = { today: 4, week: 7, month: 5, year: 6, all: 6 };

export interface LinePoint { bucket: string; value: number }

/** Area line chart over API buckets; labels follow the Dashboard chart's rules. */
export function InsightLineChart({ points, range, formatValue, height = 160, emptyLabel = 'Nothing yet for this period' }: {
  points: LinePoint[]; range: InsightRange; formatValue?: (v: number) => string; height?: number; emptyLabel?: string;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const chartWidth = width > 0 ? width : 320;
  const labelH = 20;
  const top = 8;
  const plotH = height - labelH - top;
  const n = points.length;
  const max = Math.max(0, ...points.map(p => p.value));
  const allZero = n === 0 || max === 0;
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());
  const topVal = allZero ? 1 : niceMax(max);
  const levels = [0, 0.5, 1].map(f => Math.round(topVal * f));
  // Gutter sized to the longest axis label so "$1.2k" / "12,000" never clip.
  const yLabelW = allZero ? 24 : Math.max(32, Math.min(72, Math.max(...levels.map(v => fmt(v).length)) * 7 + 10));
  const plotW = chartWidth - yLabelW;
  const x = (i: number) => yLabelW + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => top + plotH - (v / topVal) * plotH;
  const linePath = n > 0 ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') : '';
  const areaPath = n > 0 ? `${linePath} L${x(n - 1).toFixed(1)},${(top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(top + plotH).toFixed(1)} Z` : '';
  const labelIdx = selectEvenlySpacedIndices(n, AXIS_LABEL_COUNT[range]);
  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={height}>
        <Defs>
          <LinearGradient id="insightArea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity={0.28} />
            <Stop offset="1" stopColor={colors.primary} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {levels.map((v, i) => {
          const ly = y(allZero ? (i / 2) * topVal : v);
          return (
            <React.Fragment key={i}>
              <Line x1={yLabelW} y1={ly} x2={chartWidth} y2={ly} stroke={colors.border} strokeWidth={1} />
              <SvgText x={yLabelW - 6} y={ly + 4} textAnchor="end" fontSize={FS.xs} fontFamily={FONT.regular} fill={colors.mutedForeground}>
                {allZero ? '' : fmt(v)}
              </SvgText>
            </React.Fragment>
          );
        })}
        {!allZero && n > 1 && <Path d={areaPath} fill="url(#insightArea)" />}
        {!allZero && n > 1 && <Path d={linePath} stroke={colors.primary} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
        {!allZero && <Circle cx={x(n - 1)} cy={y(points[n - 1].value)} r={3.5} fill={colors.primary} />}
        {labelIdx.map(i => (
          <SvgText key={`l${i}`} x={x(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={FS.xs} fontFamily={FONT.regular} fill={colors.mutedForeground}>
            {bucketLabel(points[i].bucket, range)}
          </SvgText>
        ))}
      </Svg>
      {allZero && (
        <View pointerEvents="none" style={{ position: 'absolute', top, left: yLabelW, right: 0, height: plotH, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground }}>{emptyLabel}</Text>
        </View>
      )}
    </View>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const r = v / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return step * mag;
}

/** Numbered list row with a thumbnail — "1  [thumb]  Title / meta  value". */
export function RankedRow({ rank, thumbnailUrl, icon, title, subtitle, value, valueLabel, onPress, testID }: {
  rank: number; thumbnailUrl?: string | null; icon?: keyof typeof Feather.glyphMap; title: string; subtitle?: string;
  value: string; valueLabel?: string; onPress?: () => void; testID?: string;
}) {
  const colors = useColors();
  const s = React.useMemo(() => rowStyles(colors), [colors]);
  const body = (
    <>
      <Text style={s.rank}>{rank}</Text>
      <View style={s.thumb}>
        {thumbnailUrl
          ? <CachedImage source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} />
          : <Feather name={icon ?? 'image'} size={18} color={colors.mutedForeground} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title} numberOfLines={2}>{title}</Text>
        {!!subtitle && <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.value}>{value}</Text>
        {!!valueLabel && <Text style={s.subtitle}>{valueLabel}</Text>}
      </View>
      {!!onPress && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
    </>
  );
  if (!onPress) return <View style={s.row} testID={testID}>{body}</View>;
  return (
    <TouchableOpacity style={s.row} onPress={() => { onPress(); }} accessibilityRole="button" accessibilityLabel={title} testID={testID}>
      {body}
    </TouchableOpacity>
  );
}
const rowStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2, minHeight: COMP.minTouchTarget },
  rank: { width: 18, fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.mutedForeground, textAlign: 'center' },
  thumb: { width: 48, height: 48, borderRadius: RADIUS.sm, backgroundColor: colors.elevated, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
});

/** Label + horizontal share bar + value, for breakdown lists (locations, devices, channels). */
export function ShareBarRow({ label, value, pct, last }: { label: string; value: string; pct: number; last?: boolean }) {
  const colors = useColors();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ marginBottom: last ? 0 : SP.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: SP.sm }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.foreground }}>{label}</Text>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground }}>{value}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ width: `${clamped}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 3 }} />
      </View>
    </View>
  );
}

/** Axis money labels: whole dollars under $1k, "$1.2k" above. */
export function formatAxisMoney(cents: number): string {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(d)}`;
}

/** Short, honest empty line inside a card (no filler copy). */
export function EmptyLine({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, padding: SP.md }}>{text}</Text>;
}

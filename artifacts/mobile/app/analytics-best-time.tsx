/**
 * Best time to post — day x hour engagement heatmap from the seller's own
 * audience, plus the top 3 slots. Mobbin reference: TikTok Studio "Most active times".
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { getBestTime, type InsightRange } from '@/services/sellerInsightsService';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
const hourLong = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const STEPS = ['00', '33', '66', '99', 'CC', 'FF'];

export default function AnalyticsBestTimeScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>('30d');
  const { data, loading, error, reload } = useSellerInsight(() => getBestTime(range), [range]);

  const max = Math.max(1, ...(data?.grid.flat() ?? [0]));
  return (
    <InsightFrame title="Best time to post" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {!data || data.totalEvents === 0 ? (
        <EmptyState icon="clock" title="No engagement yet" description="Your best posting times appear once people start viewing and reacting to your posts." />
      ) : (
        <>
          <SectionTitle>Top times</SectionTitle>
          {data.recommended.length === 0 ? (
            <Card padded>
              <Text style={s.value}>Not enough engagement yet</Text>
              <Text style={s.meta}>{data.totalEvents} of {data.minEventsForRecommendation} interactions needed.</Text>
            </Card>
          ) : (
            <Card>
              {data.recommended.map((r, i) => (
                <View key={`${r.day}-${r.hour}`}>
                  {i > 0 && <CardDivider />}
                  <View style={s.slot}>
                    <Text style={s.rank}>{i + 1}</Text>
                    <Text style={[s.value, { flex: 1 }]}>{DAYS_LONG[r.day]}, {hourLong(r.hour)}</Text>
                    <Text style={s.meta}>{r.count.toLocaleString()} interactions</Text>
                  </View>
                </View>
              ))}
            </Card>
          )}
          <SectionTitle>Engagement by day and hour</SectionTitle>
          <Card padded>
            <View style={s.hoursRow}>
              <View style={s.dayLabel} />
              {[0, 6, 12, 18].map(h => (
                <Text key={h} style={[s.hourTick, { flex: 6 }]}>{hourLabel(h)}</Text>
              ))}
            </View>
            {data.grid.map((row, d) => (
              <View key={d} style={s.gridRow}>
                <Text style={s.dayLabel}>{DAYS[d]}</Text>
                {row.map((n, h) => (
                  <View
                    key={h}
                    accessibilityLabel={`${DAYS_LONG[d]} ${hourLong(h)}: ${n} interactions`}
                    style={[s.cell, { backgroundColor: n === 0 ? colors.border : colors.primary + STEPS[Math.max(1, Math.ceil((n / max) * 5))] }]}
                  />
                ))}
              </View>
            ))}
          </Card>
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md },
  rank: { width: 24, fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  hoursRow: { flexDirection: 'row', marginBottom: 4 },
  hourTick: { fontSize: 10, fontFamily: FONT.regular, color: colors.mutedForeground },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 1, marginBottom: 1 },
  dayLabel: { width: 32, fontSize: 10, fontFamily: FONT.regular, color: colors.mutedForeground },
  cell: { flex: 1, height: 18, borderRadius: RADIUS.xs / 2 },
});

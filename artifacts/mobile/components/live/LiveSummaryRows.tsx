/**
 * "Lives" rows for the seller Analytics tab: the most recent lives with
 * their date, length and sales; tapping one opens its live summary
 * (app/live-summary.tsx). Data from GET /api/live/analytics/recent.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { FONT, FS, SP } from '@/lib/theme';
import { formatLiveDate, formatLiveDuration, revenueLabel, type LiveAnalyticsListItem } from '@/lib/live/liveAnalytics';

export function LiveSummaryRows({ lives, onOpen }: { lives: LiveAnalyticsListItem[]; onOpen: (streamId: string) => void }) {
  const colors = useColors();
  return (
    <View testID="analytics-lives">
      <View style={styles.title}><SectionTitle>Lives</SectionTitle></View>
      {lives.map((live, i) => (
        <React.Fragment key={live.streamId}>
          {i > 0 && <CardDivider />}
          <Pressable
            onPress={() => onOpen(live.streamId)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`${live.title}, ${live.orders} orders, ${revenueLabel(live.revenueCents)}`}
          >
            <View style={styles.text}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>{live.title}</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {live.status === 'live' ? 'Live now' : formatLiveDate(live.startedAt)} · {formatLiveDuration(live.durationSeconds)} · {live.orders === 1 ? '1 order' : `${live.orders} orders`}
              </Text>
            </View>
            <Text style={[styles.value, { color: colors.foreground }]}>{revenueLabel(live.revenueCents)}</Text>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: SP.md, paddingTop: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2, minHeight: 56 },
  text: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  rowSub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  value: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

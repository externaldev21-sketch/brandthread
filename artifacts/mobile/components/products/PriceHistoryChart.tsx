/**
 * Product page price history + "Tell me if the price drops" (Expedia "Price
 * Tracking" 1:1, reskinned): a small silver step line of the last 90 days
 * with the high/low on the right, shown only when the price actually changed
 * in that window; under it, on a product you saved, one switch that opts in
 * to the price-drop alert for this item. That switch is the only way the
 * price-drop push reaches you without the global promotional opt-in.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useIsProductSaved } from '@/hooks/useSavedProduct';
import { ListRow } from '@/components/ui/ListRow';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { priceRange, priceStepPath, type PriceHistory } from '@/lib/priceHistory';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';

const CHART_HEIGHT = 64;

export function PriceHistoryChart({ productId }: { productId: string }) {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const { theme } = useAppTheme();
  const saved = useIsProductSaved(productId);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [alertOn, setAlertOn] = useState<boolean | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setHistory(null);
    let active = true;
    api.publicProducts.priceHistory(productId)
      .then((res) => { if (active) setHistory(res); })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    setAlertOn(null);
    if (!isSignedIn || !saved) return;
    let active = true;
    api.buyer.saved.priceAlert.get(productId)
      .then((res) => { if (active) setAlertOn(res.saved ? res.enabled : null); })
      .catch(() => {});
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, isSignedIn, saved]);

  async function toggleAlert(next: boolean) {
    setAlertOn(next);
    try {
      const res = await api.buyer.saved.priceAlert.set(productId, next);
      setAlertOn(res.enabled);
      // Ask for notification access only now, right after the buyer asked to be told.
      if (res.enabled) void requestContextualPushPermission(userId, api);
    } catch {
      setAlertOn(!next);
    }
  }

  const showChart = !!history?.changed && history.points.length >= 2;
  const showSwitch = isSignedIn && saved && alertOn !== null;
  if (!showChart && !showSwitch) return null;

  const range = showChart ? priceRange(history!.points) : null;
  const silver = theme.muted;

  return (
    <View style={styles.root} testID="product-price-history">
      {showChart && (
        <>
          <Text style={[styles.label, { color: theme.text }]}>Price history</Text>
          <View style={styles.chartRow}>
            <View
              style={styles.chart}
              onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
              accessible
              accessibilityLabel={`Price over the last 90 days, from ${formatCents(history!.points[0].priceCents)} to ${formatCents(history!.points[history!.points.length - 1].priceCents)}`}
            >
              {width > 0 && (
                <Svg width={width} height={CHART_HEIGHT}>
                  <Path
                    d={priceStepPath(history!.points, width, CHART_HEIGHT)}
                    stroke={silver}
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
            </View>
            {range && (
              <View style={styles.yLabels}>
                <Text style={[styles.meta, { color: theme.muted }]}>{formatCents(range.hi)}</Text>
                <Text style={[styles.meta, { color: theme.muted }]}>{formatCents(range.lo)}</Text>
              </View>
            )}
          </View>
          <View style={styles.xRow}>
            <View style={styles.xLabels}>
              <Text style={[styles.meta, { color: theme.muted }]}>90 days ago</Text>
              <Text style={[styles.meta, { color: theme.muted }]}>Today</Text>
            </View>
            {/* Same width as the price column above, so "Today" sits under the line's end. */}
            {range && <Text style={[styles.meta, styles.spacer]} aria-hidden>{formatCents(range.hi)}</Text>}
          </View>
        </>
      )}
      {showSwitch && (
        <ListRow
          title="Tell me if the price drops"
          toggle={{ value: !!alertOn, onChange: (v) => { void toggleAlert(v); } }}
          testID="product-price-alert"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: SP.sm },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: SP.sm },
  chartRow: { flexDirection: 'row', alignItems: 'stretch', gap: SP.sm },
  chart: { flex: 1, height: CHART_HEIGHT },
  yLabels: { height: CHART_HEIGHT, justifyContent: 'space-between' },
  xRow: { flexDirection: 'row', gap: SP.sm, marginTop: 4 },
  xLabels: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  spacer: { opacity: 0 },
  meta: { fontSize: FS.meta, fontFamily: FONT.regular, fontVariant: ['tabular-nums'] },
});

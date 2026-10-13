/**
 * One-line cumulative chart for the seller drop waitlist screen
 * (app/seller-drop-hype.tsx). Same line weight, colour and axis text as the
 * dashboard's SellerDashboardChart, but without its range pills, scrubbing
 * or area fill: a waitlist only ever has one range (first signup to today)
 * and the brief is a single line. Straight segments, not a smoothed curve,
 * so a cumulative count never appears to dip.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { formatDayKey, type DropHypePoint } from '@/lib/dropHype';
import { layoutSeriesPoints } from '@/lib/svgSmoothPath';
import { FONT, FS, SP } from '@/lib/theme';

const HEIGHT = 168;
const EMPTY_HEIGHT = 112;

export function DropHypeChart({ series, theme }: { series: DropHypePoint[]; theme: AppThemePreset }) {
  const [width, setWidth] = useState(0);
  const isEmpty = series.length === 0 || series[series.length - 1].cumulative === 0;
  const height = isEmpty ? EMPTY_HEIGHT : HEIGHT;
  // A single day still draws a line: repeat the point so it spans the width.
  const values = useMemo(() => {
    const v = series.map((p) => p.cumulative);
    return v.length === 1 ? [v[0], v[0]] : v;
  }, [series]);
  const path = useMemo(() => {
    if (isEmpty || width <= 0) return '';
    const pts = layoutSeriesPoints(values, width, height);
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }, [isEmpty, values, width, height]);

  const first = series[0]?.date;
  return (
    <View testID="drop-hype-chart">
      <View
        style={{ height }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <Svg width={width} height={height}>
            {isEmpty ? (
              <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={theme.borderSubtle} strokeWidth={1} />
            ) : (
              <Path d={path} stroke={theme.accent} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            )}
          </Svg>
        )}
        {isEmpty && (
          <View style={styles.emptyWrap} pointerEvents="none">
            <Text style={[styles.emptyText, { color: theme.muted }]}>No signups yet</Text>
          </View>
        )}
      </View>
      {!isEmpty && first && (
        <View style={styles.axisRow}>
          <Text style={[styles.axisLabel, { color: theme.subtle }]}>{formatDayKey(first)}</Text>
          <Text style={[styles.axisLabel, { color: theme.subtle }]}>Today</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: FONT.medium, fontSize: FS.sm },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.sm },
  axisLabel: { fontFamily: FONT.medium, fontSize: FS.meta },
});

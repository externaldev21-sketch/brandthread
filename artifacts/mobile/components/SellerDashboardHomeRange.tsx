/**
 * The Dashboard's range control under the chart: a segmented control
 * Today / 7D / 30D / 90D (components/ui SegmentedControl, surface variant).
 * The Analytics screens keep their own Today/Week/Month/Year/All pills
 * (SellerDashboardRangePills) — this is the Dashboard-only range set.
 */
import React from 'react';
import { StyleSheet } from 'react-native';

import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { HOME_DASHBOARD_RANGES, type SellerHomeDashboardRange } from '@/lib/sellerDashboardHome';
import { SP } from '@/lib/theme';

export function SellerDashboardHomeRange({
  range,
  onRangeChange,
}: {
  range: SellerHomeDashboardRange;
  onRangeChange: (range: SellerHomeDashboardRange) => void;
}) {
  return (
    <SegmentedControl
      options={HOME_DASHBOARD_RANGES}
      selectedId={range}
      onChange={(id) => onRangeChange(id as SellerHomeDashboardRange)}
      testID="seller-dashboard-range-pills"
      style={styles.root}
    />
  );
}

const styles = StyleSheet.create({
  root: { marginTop: SP.md },
});

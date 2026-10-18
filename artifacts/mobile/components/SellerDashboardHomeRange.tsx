/**
 * The Dashboard's current Today / 7D / 30D / 90D data windows, rendered with
 * the approved shared glass-pill layout. Keep the existing query ranges:
 * a visual merge must not label 90 days as a year or as all-time data.
 */
import React from 'react';
import { StyleSheet } from 'react-native';

import { SellerDashboardRangePills } from '@/components/SellerDashboardRangePills';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { HOME_DASHBOARD_RANGES, type SellerHomeDashboardRange } from '@/lib/sellerDashboardHome';
import { SP } from '@/lib/theme';

export function SellerDashboardHomeRange({
  range,
  onRangeChange,
}: {
  range: SellerHomeDashboardRange;
  onRangeChange: (range: SellerHomeDashboardRange) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <SellerDashboardRangePills
      ranges={HOME_DASHBOARD_RANGES}
      range={range}
      onRangeChange={onRangeChange}
      theme={theme}
      style={styles.root}
    />
  );
}

const styles = StyleSheet.create({
  root: { marginTop: SP.md },
});

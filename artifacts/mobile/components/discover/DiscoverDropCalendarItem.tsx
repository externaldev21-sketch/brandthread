/**
 * One item of Discover's Drops calendar (lib/dropCalendar.ts): a bold day
 * heading ("Live now", "Today", "Tomorrow", "Thu, Oct 16") or the existing
 * DiscoverDropRow with its notify bell.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import type { DropCalendarItem } from '@/lib/dropCalendar';
import { DiscoverDropRow } from '@/components/discover/DiscoverDropRow';
import { DropNotifyBell } from '@/components/drops/DropNotifyBell';

export function DiscoverDropCalendarItem({ item }: { item: DropCalendarItem }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (item.kind === 'header') {
    return <Text style={styles.heading} accessibilityRole="header">{item.title}</Text>;
  }
  return (
    <DiscoverDropRow
      drop={item.drop}
      trailing={<DropNotifyBell dropId={item.drop.id} dropName={item.drop.name} />}
    />
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  heading: { ...TYPE_SCALE.headline, color: theme.text, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.sm },
});

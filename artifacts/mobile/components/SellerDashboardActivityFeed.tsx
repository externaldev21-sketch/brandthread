/**
 * Dashboard "Recent activity": new orders, new followers and new reviews,
 * newest first, each with a short relative time ("2m", "3h"). Built only
 * from real rows (see mergeDashboardActivity); hidden when there are none.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { SellerDashboardSectionTitle } from '@/components/SellerDashboardSectionTitle';
import { shortRelativeTime, type ActivityKind, type DashboardActivityItem } from '@/lib/sellerDashboardHome';
import { FONT, SP } from '@/lib/theme';

const ICON: Record<ActivityKind, React.ComponentProps<typeof Feather>['name']> = {
  order: 'shopping-bag',
  follower: 'user-plus',
  review: 'star',
};

export function SellerDashboardActivityFeed({
  items,
  theme,
  onNavigate,
  onSeeAll,
  now,
}: {
  items: DashboardActivityItem[];
  theme: AppThemePreset;
  onNavigate: (route: string) => void;
  onSeeAll?: () => void;
  now?: number;
}) {
  if (items.length === 0) return null;
  return (
    <View testID="seller-dashboard-activity-feed">
      <SellerDashboardSectionTitle title="Recent activity" theme={theme} action={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} />
      {items.map((item, index) => {
        const content = (
          <>
            <View style={[styles.iconCircle, { backgroundColor: theme.card, borderColor: theme.borderSubtle }]}>
              <Feather name={ICON[item.kind]} size={16} color={theme.text} />
            </View>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.time, { color: theme.muted }]} numberOfLines={1}>{shortRelativeTime(item.at, now)}</Text>
          </>
        );
        const rowStyle = [styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }];
        return item.route ? (
          <PressableScale key={item.id} onPress={() => onNavigate(item.route!)} style={rowStyle} accessibilityRole="button" accessibilityLabel={item.title}>
            {content}
          </PressableScale>
        ) : (
          <View key={item.id} style={rowStyle} accessible accessibilityLabel={item.title}>{content}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  iconCircle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, fontFamily: FONT.medium, fontSize: 15 },
  time: { fontFamily: FONT.regular, fontSize: 13, fontVariant: ['tabular-nums'], marginLeft: SP.xs },
});

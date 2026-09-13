import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PressableScale } from '@/components/BrandthreadUI';
import { sellerCompactGridStyles } from '@/components/sellerCompactGridLayout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BORDER, CARD_GLASS, FG, FONT, FS, MUTED, RADIUS } from '@/lib/theme';

export interface SellerDashboardKPI {
  label: string;
  value: string;
  onPress?: () => void;
  trend?: { label: string; direction: string } | null;
  trendColor?: string;
}

interface KPICardProps extends SellerDashboardKPI {
  style?: StyleProp<ViewStyle>;
}

export function SellerDashboardKPICard({
  label,
  value,
  onPress,
  trend,
  trendColor = MUTED,
  style,
}: KPICardProps) {
  const { theme } = useAppTheme();
  const cardStyle = [
    styles.card,
    {
      borderColor: BORDER,
      shadowColor: theme.accent,
    },
  ];
  const content = (
    <>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{value}</Text>
      {trend && (
        <View style={[styles.trend, { backgroundColor: trendColor + '12', borderColor: trendColor + '30' }]}>
          <Feather
            name={trend.direction === 'up' ? 'trending-up' : trend.direction === 'down' ? 'trending-down' : 'minus'}
            size={10}
            color={trendColor}
          />
          <Text style={[styles.trendText, { color: trendColor }]} numberOfLines={1}>{trend.label}</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={[sellerCompactGridStyles.column, style]} testID={`seller-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {onPress ? (
        <PressableScale onPress={onPress} style={cardStyle}>{content}</PressableScale>
      ) : (
        <View style={cardStyle}>{content}</View>
      )}
    </View>
  );
}

export function SellerDashboardKPIGrid({ cards }: { cards: SellerDashboardKPI[] }) {
  return (
    <View style={[sellerCompactGridStyles.grid, styles.grid]} testID="seller-kpi-grid">
      {cards.map(card => <SellerDashboardKPICard key={card.label} {...card} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    marginBottom: 10,
  },
  card: {
    width: '100%',
    minWidth: 0,
    minHeight: 96,
    justifyContent: 'center',
    gap: 4,
    padding: 14,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    backgroundColor: CARD_GLASS,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  label: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
  value: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    letterSpacing: -0.5,
  },
  trend: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  trendText: {
    fontSize: 9,
    fontFamily: FONT.semibold,
  },
});
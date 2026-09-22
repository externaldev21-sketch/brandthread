import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { PressableScale } from '@/components/BrandthreadUI';
import { sellerCompactGridStyles } from '@/components/sellerCompactGridLayout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS } from '@/lib/theme';

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
  trendColor,
  style,
}: KPICardProps) {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & Record<string, string>;
  trendColor ??= palette.muted;
  const cardStyle = [
    styles.card,
    {
      backgroundColor: palette.card ?? palette.surface,
      borderColor: palette.border,
      shadowColor: theme.accent,
    },
  ];
  const content = (
    <>
        <Text style={[styles.label, { color: palette.muted }]} numberOfLines={2} maxFontSizeMultiplier={2}>{label}</Text>
      <Text
         style={[styles.value, { color: palette.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
        maxFontSizeMultiplier={2}
      >
        {value}
      </Text>
      {trend && (
        <View style={[styles.trend, { backgroundColor: trendColor + '12', borderColor: trendColor + '30' }]}>
          <Feather
            name={trend.direction === 'up' ? 'trending-up' : trend.direction === 'down' ? 'trending-down' : 'minus'}
            size={10}
            color={trendColor}
          />
          <Text
            style={[styles.trendText, { color: trendColor }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={2}
          >
            {trend.label}
          </Text>
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

const makeStyles = () => StyleSheet.create({
  grid: {
    marginBottom: 10,
  },
  card: {
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 96,
    justifyContent: 'center',
    gap: 4,
    padding: 14,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    lineHeight: 16,
    minHeight: 32,
  },
  value: {
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
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
});

const styles = makeStyles();
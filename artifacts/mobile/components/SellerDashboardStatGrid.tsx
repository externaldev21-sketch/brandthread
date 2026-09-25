import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export interface SellerDashboardStatTileData {
  key: string;
  label: string;
  value: string;
  deltaLabel?: string;
  deltaDirection?: 'up' | 'down' | 'flat';
}

export function SellerDashboardStatGrid({
  tiles,
  activeKey,
  onSelect,
  theme,
}: {
  tiles: SellerDashboardStatTileData[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  theme: AppThemePreset;
}) {
  return (
    <View style={styles.grid} testID="seller-dashboard-stat-grid">
      {tiles.map((tile) => {
        const selected = tile.key === activeKey;
        const deltaColor = tile.deltaDirection === 'up' ? theme.success
          : tile.deltaDirection === 'down' ? theme.error
          : theme.muted;
        return (
          <TouchableOpacity
            key={tile.key}
            testID={`seller-dashboard-stat-tile-${tile.key}`}
            style={[
              styles.tile,
              { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.borderSubtle },
            ]}
            activeOpacity={0.8}
            onPress={() => onSelect(tile.key)}
            accessibilityRole="button"
            accessibilityLabel={`${tile.label}: ${tile.value}${tile.deltaLabel ? `, ${tile.deltaLabel}` : ''}. Tap to chart this metric.`}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, { color: theme.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.8}>
              {tile.label.toUpperCase()}
            </Text>
            <Text
              style={[styles.value, { color: theme.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={1.6}
            >
              {tile.value}
            </Text>
            {tile.deltaLabel ? (
              <Text style={[styles.delta, { color: deltaColor }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                {tile.deltaLabel}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 92,
    padding: SP.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 4,
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONT.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  value: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  delta: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
});

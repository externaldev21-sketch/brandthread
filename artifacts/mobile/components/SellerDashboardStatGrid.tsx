import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';

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
        // Monochrome brand: direction is conveyed by the arrow glyph, never by color.
        const deltaColor = tile.deltaDirection === 'flat' ? theme.muted : theme.text;
        const deltaArrow = tile.deltaDirection === 'up' ? '↑ ' : tile.deltaDirection === 'down' ? '↓ ' : '';
        return (
          <TouchableOpacity
            key={tile.key}
            testID={`seller-dashboard-stat-tile-${tile.key}`}
            style={[
              styles.tile,
              // Flat stat cells on black, separated by a hairline; the selected
              // (charted) cell's hairline turns solid (BRANDTHREAD_DESIGN.md).
              { borderTopColor: selected ? theme.accent : theme.border },
            ]}
            activeOpacity={0.8}
            onPress={() => onSelect(tile.key)}
            accessibilityRole="button"
            accessibilityLabel={`${tile.label}: ${tile.value}${tile.deltaLabel ? `, ${tile.deltaLabel}` : ''}. Tap to chart this metric.`}
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, { color: theme.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.8}>
              {tile.label}
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
                {deltaArrow}{tile.deltaLabel}
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
    columnGap: SP.sm,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 92,
    paddingVertical: SP.md,
    borderTopWidth: 1,
    gap: 4,
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
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

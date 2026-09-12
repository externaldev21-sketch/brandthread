import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { QuickActionCard } from '@/components/BrandthreadUI';

export interface SellerQuickAction {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  badge?: boolean;
  onPress: () => void;
}

export function SellerQuickActionsGrid({ actions }: { actions: SellerQuickAction[] }) {
  return (
    <View style={styles.grid} testID="seller-quick-actions-grid">
      {actions.map(action => (
        <View
          key={action.label}
          style={styles.column}
          testID={`seller-quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <QuickActionCard {...action} style={styles.card} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  column: {
    width: '48%',
    minWidth: 0,
  },
  card: {
    width: '100%',
    minWidth: 0,
  },
});
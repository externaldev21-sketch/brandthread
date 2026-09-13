import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { QuickActionCard } from '@/components/BrandthreadUI';
import { sellerCompactGridStyles } from '@/components/sellerCompactGridLayout';
import { BORDER, SELLER_DASHBOARD_GLASS } from '@/lib/theme';

export interface SellerQuickAction {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  accent: string;
  badge?: boolean;
  onPress: () => void;
}

export function SellerQuickActionsGrid({ actions }: { actions: SellerQuickAction[] }) {
  return (
    <View style={sellerCompactGridStyles.grid} testID="seller-quick-actions-grid">
      {actions.map(action => (
        <View
          key={action.label}
          style={sellerCompactGridStyles.column}
          testID={`seller-quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <QuickActionCard {...action} style={styles.card} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    minWidth: 0,
    backgroundColor: SELLER_DASHBOARD_GLASS,
    borderColor: BORDER,
  },
});
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
  icon: keyof typeof Feather.glyphMap;
}

export function StatCard({ label, value, change, positive = true, icon }: StatCardProps) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      {change != null && (
        <Text style={[styles.change, { color: positive ? colors.success : colors.destructive }]}>
          {positive ? '↑' : '↓'} {change}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 3,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  value: { fontSize: 22, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  label: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  change: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 2 },
});

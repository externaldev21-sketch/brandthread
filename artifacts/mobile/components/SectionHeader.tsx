import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  colors?: { foreground: string; primary: string };
}

export function SectionHeader({ title, action, onAction, colors: colorsProp }: SectionHeaderProps) {
  const themeColors = useColors();
  const colors = colorsProp ?? themeColors;
  return (
    <View style={styles.row}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {action && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.action, { color: colors.primary }]}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  action: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});

/**
 * Small silver check-seal shown next to OFFICIAL Brandthread community names.
 * User-created groups never render it.
 */
import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function VerifiedMark({ size = 14 }: { size?: number }) {
  const colors = useColors();
  return (
    <View
      accessibilityLabel="Official Brandthread community"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.foreground, alignItems: 'center', justifyContent: 'center' }}
    >
      <Feather name="check" size={Math.round(size * 0.68)} color={colors.background} />
    </View>
  );
}

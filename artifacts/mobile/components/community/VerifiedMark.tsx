/**
 * Small silver check-seal shown next to OFFICIAL Brandthread community names.
 * User-created groups never render it.
 */
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';

export function VerifiedMark({ size = 14 }: { size?: number }) {
  const colors = useColors();
  return (
    <View
      accessibilityLabel="Official Brandthread community"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.foreground, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="check" size={Math.round(size * 0.68)} color={colors.background} />
    </View>
  );
}

/**
 * The same mark as an inline glyph for use INSIDE a <Text> (after a name that may wrap onto two lines):
 * it is text, so it stays glued to the last word instead of orphaning onto its own line.
 */
export function VerifiedGlyph({ size = 14 }: { size?: number }) {
  const colors = useColors();
  return (
    <>
      {'\u00A0'}
      <Ionicons name="checkmark-circle" size={size} color={colors.foreground} accessibilityLabel="Official Brandthread community" />
    </>
  );
}

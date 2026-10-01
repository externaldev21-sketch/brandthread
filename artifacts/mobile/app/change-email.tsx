import React from 'react';
import { View } from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { ChangeIdentifier } from '@/components/security/ChangeIdentifier';

export default function ChangeEmail() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Change email" />
      <ChangeIdentifier kind="email" />
    </View>
  );
}

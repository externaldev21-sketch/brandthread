import React from 'react';
import { View } from 'react-native';
import { useUser } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { ChangeIdentifier } from '@/components/security/ChangeIdentifier';

export default function ChangeEmail() {
  const colors = useColors();
  const { user } = useUser();
  // No email on the account yet: this flow adds one rather than changing it.
  const title = user && !user.primaryEmailAddress ? 'Add email' : 'Change email';
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={title} />
      <ChangeIdentifier kind="email" />
    </View>
  );
}

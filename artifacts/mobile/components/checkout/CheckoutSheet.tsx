/**
 * The sheet a collapsed Order review row opens (Shop: "Contact", "Ship to"):
 * the shared BottomSheet (drag down or tap outside to close) with a title
 * and a Done button. The page under it stays as it was.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui';
import { FONT, FS, SP } from '@/lib/theme';
import { useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

export function CheckoutSheet({
  visible, title, onClose, doneLabel = 'Done', doneDisabled, children, testID,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  children: React.ReactNode;
  testID?: string;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  return (
    <BottomSheet visible={visible} onClose={onClose} testID={testID}>
      <View style={s.body}>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        {children}
        <Button label={doneLabel} fullWidth onPress={onClose} disabled={doneDisabled} testID={testID ? `${testID}-done` : undefined} />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (ck: CheckoutColors) => StyleSheet.create({
  body: { paddingHorizontal: SP.md, paddingBottom: SP.md },
  title: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text, textAlign: 'center', paddingBottom: SP.xs },
});

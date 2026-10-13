/**
 * "Gift this" row in the checkout's shipping area (lululemon "Adding a gift
 * message", reskinned): a checkbox on the left, "This is a gift, add a
 * message" and a chevron. The row opens Add a Gift Message; once saved it
 * reads "This is a gift", checked, and the chevron edits it. Tapping the
 * checked box removes the gift. Adding a gift is free.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ListRow } from '@/components/ui/ListRow';
import { hapticLight } from '@/lib/haptics';
import { resetGiftOption, useGiftOption } from '@/lib/checkout/giftOptionStore';
import { CheckoutSection, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

export function GiftOptionRow() {
  const router = useRouter();
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const gift = useGiftOption();
  const checked = gift !== null;
  const open = () => router.push('/checkout-gift-message' as never);

  return (
    <CheckoutSection testID="checkout-gift-option">
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            if (!checked) { open(); return; }
            hapticLight();
            resetGiftOption();
          }}
          hitSlop={12}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={checked ? 'This is a gift' : 'This is a gift, add a message'}
          testID="checkout-gift-checkbox"
          style={[styles.box, checked ? styles.boxChecked : null]}
        >
          {checked ? <Feather name="check" size={14} color={ck.bg} /> : null}
        </Pressable>
        <View style={styles.listRow}>
          <ListRow
            title={checked ? 'This is a gift' : 'This is a gift, add a message'}
            chevron
            onPress={open}
            testID="checkout-gift-row"
          />
        </View>
      </View>
    </CheckoutSection>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    box: {
      width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center', borderColor: ck.subtle,
    },
    boxChecked: { borderColor: ck.text, backgroundColor: ck.text },
    listRow: { flex: 1, minWidth: 0 },
  });
}

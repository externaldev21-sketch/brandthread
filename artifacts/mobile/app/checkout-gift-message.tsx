/**
 * Add a Gift Message (lululemon "Adding a gift message", reskinned): pushed
 * from the checkout's "This is a gift" row. To, From (prefilled with the
 * buyer's name when known) and Gift Message; Save in the header stores the
 * gift (lib/checkout/giftOptionStore.ts) and pops back to checkout. The
 * order's packing slip then prints as a gift receipt with prices hidden.
 * Local only: this screen calls no API.
 */
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CheckoutField } from '@/components/checkout/CheckoutPrimitives';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP } from '@/lib/theme';
import {
  GIFT_MESSAGE_MAX, GIFT_NAME_MAX, getGiftOption, setGiftOption,
} from '@/lib/checkout/giftOptionStore';

type Theme = ReturnType<typeof useAppTheme>['theme'];

export default function CheckoutGiftMessageScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const saved = getGiftOption();
  const buyerName = (user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ')).trim();

  const [to, setTo] = useState(saved?.to ?? '');
  const [from, setFrom] = useState(saved ? saved.from : buyerName.slice(0, GIFT_NAME_MAX));
  const [message, setMessage] = useState(saved?.message ?? '');

  const save = () => {
    setGiftOption({ to, from, message });
    goBackOr(router, '/buyer-checkout');
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title="Add a Gift Message"
        onBack={() => goBackOr(router, '/buyer-checkout')}
        rightElement={(
          <Pressable onPress={save} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save" style={s.saveBtn} testID="gift-message-save">
            <Text style={s.saveText}>Save</Text>
          </Pressable>
        )}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl }}
      >
        <CheckoutField
          label="To"
          placeholder="Full Name"
          value={to}
          onChangeText={setTo}
          maxLength={GIFT_NAME_MAX}
          autoCapitalize="words"
          autoComplete="off"
          testID="gift-message-to"
        />
        <CheckoutField
          label="From"
          placeholder="Full Name"
          value={from}
          onChangeText={setFrom}
          maxLength={GIFT_NAME_MAX}
          autoCapitalize="words"
          autoComplete="name"
          testID="gift-message-from"
        />
        <CheckoutField
          label="Gift Message"
          value={message}
          onChangeText={setMessage}
          maxLength={GIFT_MESSAGE_MAX}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          hint={`${message.length}/${GIFT_MESSAGE_MAX}`}
          testID="gift-message-text"
        />
        <Text style={s.footnote}>Your message will be printed on a gift receipt with prices hidden</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    saveBtn: { minWidth: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
    saveText: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
    footnote: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: theme.muted, marginTop: SP.xs },
  });
}

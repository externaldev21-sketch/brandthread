/**
 * Add a card from the saved payment methods screen, without a purchase.
 *
 * The server starts a Stripe SetupIntent on the buyer's Stripe Customer
 * (POST /api/buyer/payment-methods/setup-intent); Stripe's own card field
 * confirms it, so card data never touches Brandthread. Native uses
 * @stripe/stripe-react-native (confirmSetupIntent), web uses Stripe.js
 * (confirmSetup with the Payment Element). Only rendered where
 * stripePaymentAvailable() is true; the screen shows a note otherwise.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { CardSetupController, CardSetupProvider, SetupCardEntry } from '@/components/checkout/StripePayment';
import type { CardSetupControllerApi } from './cardSetupTypes';
import { useApi } from '@/lib/api';
import { friendlyError } from '@/lib/friendlyError';
import { showAlert } from '@/lib/actionSheet';
import { haptics } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

export const ADD_CARD_START_FALLBACK = "Couldn't start adding your card. Try again.";
export const ADD_CARD_UNAVAILABLE_COPY = "Adding a card isn't available here yet. Cards you use at checkout are saved here.";

export function AddCardPanel({ onAdded, onCancel, onUnavailable }: {
  /** The card is saved on the buyer's Stripe customer: refresh the list. */
  onAdded: () => void;
  onCancel: () => void;
  /** Stripe.js failed to load (web): the screen swaps to the unavailable note. */
  onUnavailable: () => void;
}) {
  const palette = useColors();
  const s = React.useMemo(() => makeStyles(palette), [palette]);
  const api = useApi();
  const controller = useRef<CardSetupControllerApi>(null);
  const [complete, setComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  // A ref as well as state: two taps in the same frame both see saving=false.
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current || !complete) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const outcome = await controller.current?.confirmSetup(async () => {
        try {
          const { clientSecret } = await api.reviews.createPaymentMethodSetupIntent();
          return clientSecret || null;
        } catch (err) {
          showAlert("Couldn't add card", friendlyError(err, ADD_CARD_START_FALLBACK));
          return null;
        }
      });
      if (!outcome || outcome.status === 'canceled') return;
      if (outcome.status === 'failed') {
        haptics.error();
        showAlert("Couldn't add card", outcome.message);
        return;
      }
      haptics.success();
      showAlert('Card added', 'You can pick it at checkout.');
      onAdded();
    } catch (err) {
      showAlert("Couldn't add card", friendlyError(err, ADD_CARD_START_FALLBACK));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <CardSetupProvider onUnavailable={onUnavailable}>
      <View style={s.panel} accessibilityLabel="Add a card" testID="add-card-panel">
        <Text style={s.title} accessibilityRole="header">Add a card</Text>
        <SetupCardEntry onCompleteChange={setComplete} disabled={saving} />
        <CardSetupController ref={controller} />
        <View style={s.actions}>
          <Button
            label="Cancel"
            onPress={onCancel}
            variant="tertiary"
            size="small"
            disabled={saving}
            style={s.action}
            testID="add-card-cancel"
          />
          <Button
            label="Save card"
            onPress={() => { void save(); }}
            size="small"
            loading={saving}
            disabled={!complete || saving}
            accessibilityHint="Saves this card to your account for checkout"
            style={s.action}
            testID="add-card-save"
          />
        </View>
      </View>
    </CardSetupProvider>
  );
}

const makeStyles = (palette: ReturnType<typeof useColors>) => StyleSheet.create({
  panel: {
    backgroundColor: palette.card, borderRadius: RADII.card, borderWidth: 1, borderColor: palette.border,
    padding: SPACING.md, gap: SPACING.md, marginBottom: SPACING.lg,
  },
  title: { ...TYPE_SCALE.callout, fontFamily: FONT.semibold, color: palette.foreground },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
  action: { minHeight: 44 },
});

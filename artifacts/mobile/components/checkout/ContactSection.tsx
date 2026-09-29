/**
 * CONTACT: email (receipt and order updates) and phone (delivery updates),
 * validated inline with the same rules that gate the Pay button.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { CheckoutContact } from '@/services/cartTypes';
import { getCheckoutContactErrors } from '@/lib/checkoutReadiness';
import { SP } from '@/lib/theme';
import { CheckoutField, CheckoutSection } from './CheckoutPrimitives';

export function ContactSection({
  contact, onChange, showErrors, first,
}: {
  contact: Partial<CheckoutContact>;
  onChange: (next: Partial<CheckoutContact>) => void;
  showErrors: boolean;
  first?: boolean;
}) {
  const errors = getCheckoutContactErrors(contact);
  return (
    <CheckoutSection title="Contact" first={first} testID="checkout-contact">
      <CheckoutField
        label="Email"
        value={contact.email ?? ''}
        onChangeText={email => onChange({ ...contact, email: email.trim() })}
        error={errors.email}
        showError={showErrors}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        testID="checkout-email"
      />
      <View style={styles.last}>
        <CheckoutField
          label="Phone"
          value={contact.phone ?? ''}
          onChangeText={phone => onChange({ ...contact, phone })}
          error={errors.phone}
          showError={showErrors}
          hint="For delivery updates only"
          placeholder="(555) 555-0142"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="done"
          style={{ marginBottom: 0 }}
          testID="checkout-phone"
        />
      </View>
    </CheckoutSection>
  );
}

const styles = StyleSheet.create({ last: { marginBottom: SP.xs } });

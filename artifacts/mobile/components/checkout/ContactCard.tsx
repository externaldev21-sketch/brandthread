/**
 * Contact — email (order confirmation) and phone (delivery updates), both
 * labeled, bordered and validated inline with the same rules
 * `getCheckoutBlockingSection` uses to gate the Place order button.
 */
import React from 'react';
import type { CheckoutContact } from '@/services/cartTypes';
import { getCheckoutContactErrors } from '@/lib/checkoutReadiness';
import { CheckoutCard, CheckoutField } from './CheckoutPrimitives';

export function ContactCard({
  contact, onChange, showErrors,
}: {
  contact: Partial<CheckoutContact>;
  onChange: (next: Partial<CheckoutContact>) => void;
  showErrors: boolean;
}) {
  const errors = getCheckoutContactErrors(contact);
  return (
    <CheckoutCard title="Contact" testID="checkout-contact">
      <CheckoutField
        label="Email"
        value={contact.email ?? ''}
        onChangeText={email => onChange({ ...contact, email: email.trim() })}
        error={errors.email}
        showError={showErrors}
        hint="Your receipt and order updates go here"
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        testID="checkout-email"
      />
      <CheckoutField
        label="Phone"
        value={contact.phone ?? ''}
        onChangeText={phone => onChange({ ...contact, phone })}
        error={errors.phone}
        showError={showErrors}
        hint="Only used for delivery updates"
        placeholder="(555) 555-0142"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        style={{ marginBottom: 0 }}
        testID="checkout-phone"
      />
    </CheckoutCard>
  );
}

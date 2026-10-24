/**
 * Saving a card without a purchase (Stripe SetupIntent). Both Stripe wrappers
 * (components/checkout/StripePayment.tsx / .web.tsx) export a
 * <CardSetupController/> that registers this API. Card data stays inside
 * Stripe's own field; the screen only gets an outcome back.
 */
import type { ConfirmOutcome, GetClientSecret } from '@/components/checkout/stripePaymentTypes';

export interface CardSetupControllerApi {
  /** Saves the card typed into <SetupCardEntry/>; null when getClientSecret failed and the screen already said why. */
  confirmSetup(getClientSecret: GetClientSecret): Promise<ConfirmOutcome | null>;
}

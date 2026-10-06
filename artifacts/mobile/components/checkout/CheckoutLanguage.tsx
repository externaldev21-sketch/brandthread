/**
 * The buyer checkout's language (lib/checkoutI18n.ts). app/buyer-checkout.tsx
 * provides it; every checkout component reads it with useCheckoutT(). Outside
 * a provider (or before the store language is known) it is English.
 */
import React, { createContext, useCallback, useContext } from 'react';
import { translateCheckout, type CheckoutLanguage } from '@/lib/checkoutI18n';

const CheckoutLanguageContext = createContext<CheckoutLanguage>('en');

export function CheckoutLanguageProvider({ language, children }: { language: CheckoutLanguage; children: React.ReactNode }) {
  return <CheckoutLanguageContext.Provider value={language}>{children}</CheckoutLanguageContext.Provider>;
}

export function useCheckoutLanguage(): CheckoutLanguage {
  return useContext(CheckoutLanguageContext);
}

export type CheckoutT = (text: string, vars?: Record<string, string | number>) => string;

/** t('Pay {amount}', { amount }) in the checkout's language. */
export function useCheckoutT(): CheckoutT {
  const language = useContext(CheckoutLanguageContext);
  return useCallback((text: string, vars?: Record<string, string | number>) => translateCheckout(language, text, vars), [language]);
}

/**
 * "By placing your order you agree to the Terms of Service and Privacy
 * Policy." — one line of small text under the Place order button with real
 * links (GOAT / lululemon pattern), replacing the old client-only terms
 * checkbox. Links reuse the app's own /terms and /privacy screens, the same
 * routes LegalConsent (sign-up) links to.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { LEGAL_DOCUMENTS } from '@/content/legal';
import { FONT, FS } from '@/lib/theme';
import { templateParts } from '@/lib/checkoutI18n';
import { useCheckoutLanguage, useCheckoutT } from './CheckoutLanguage';

export function CheckoutTermsLine({ actionLabel = 'placing your order' }: { actionLabel?: string }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const language = useCheckoutLanguage();
  const t = useCheckoutT();
  const link = (label: string, route: string) => (
    <Text
      style={[styles.link, { color: theme.text }]}
      onPress={() => router.push(route as never)}
      accessibilityRole="link"
      suppressHighlighting
    >
      {label}
    </Text>
  );
  if (actionLabel === 'placing your order') {
    // The checkout's language (lib/checkoutI18n.ts): links fill the template's slots.
    const links: Record<string, React.ReactNode> = {
      terms: link(t('Terms of Service'), LEGAL_DOCUMENTS.terms.route),
      privacy: link(t('Privacy Policy'), LEGAL_DOCUMENTS.privacy.route),
    };
    return (
      <Text style={[styles.text, { color: theme.muted }]} testID="checkout-terms-line">
        {templateParts(language, 'By placing your order you agree to the {terms} and {privacy}.').map((part, index) => (
          'slot' in part ? <React.Fragment key={index}>{links[part.slot]}</React.Fragment> : <React.Fragment key={index}>{part.text}</React.Fragment>
        ))}
      </Text>
    );
  }
  return (
    <Text style={[styles.text, { color: theme.muted }]} testID="checkout-terms-line">
      By {actionLabel} you agree to the {link('Terms of Service', LEGAL_DOCUMENTS.terms.route)} and {link('Privacy Policy', LEGAL_DOCUMENTS.privacy.route)}.
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: FONT.medium, fontSize: FS.meta, lineHeight: 17, textAlign: 'center' },
  link: { fontFamily: FONT.medium, textDecorationLine: 'underline' },
});

/**
 * Verified brands (feature 63): the public rules for the verified badge.
 * Opened from the "Verified brand" chip on a store and from the seller's own
 * verification screen. Static copy, readable signed out; it describes exactly
 * what deriveSellerVerified (api-server lib/sellerEligibility.ts) checks.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';

export const VERIFIED_BRAND_RULES: { title: string; body: string }[] = [
  {
    title: 'Identity confirmed',
    body: 'The person behind the brand scanned a government ID and took a live selfie with Stripe Identity. Brandthread keeps the result, not the images.',
  },
  {
    title: 'Good standing',
    body: 'The account has no suspension and no open restriction for breaking the Community Guidelines or the Seller Agreement.',
  },
  {
    title: 'Real listings',
    body: 'Listings are the brand’s own work or genuine items it has the right to sell. Counterfeits and replicas are never allowed.',
  },
];

export const VERIFIED_BRAND_LOSS: string[] = [
  'An upheld counterfeit or intellectual property report',
  'A suspension or policy restriction on the account',
  'A failed or expired identity check',
];

export default function VerifiedBrandsScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  return (
    <View style={s.root}>
      <ScreenHeader title="Verified brands" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + SP.xl }]}>
        <View style={s.badgeRow}>
          <Feather name="check-circle" size={28} color={theme.text} />
          <Text style={s.lead}>The check next to a brand’s name means Brandthread confirmed who runs it.</Text>
        </View>

        <Text style={s.section}>What a brand needs</Text>
        {VERIFIED_BRAND_RULES.map((rule) => (
          <View key={rule.title} style={s.rule}>
            <Text style={s.ruleTitle}>{rule.title}</Text>
            <Text style={s.body}>{rule.body}</Text>
          </View>
        ))}

        <Text style={s.section}>When the badge comes off</Text>
        {VERIFIED_BRAND_LOSS.map((line) => (
          <View key={line} style={s.bulletRow}>
            <Text style={s.bullet}>•</Text>
            <Text style={[s.body, s.flex]}>{line}</Text>
          </View>
        ))}

        <Text style={s.section}>What it doesn’t mean</Text>
        <Text style={s.body}>
          Verification confirms identity and standing. It isn’t an endorsement of a brand’s products, and every order is still covered by Brandthread purchase protection.
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    flex: { flex: 1 },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.md },
    lead: { flex: 1, fontFamily: FONT.regular, fontSize: FS.md, lineHeight: 24, color: theme.text },
    section: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.text, marginTop: SP.lg, marginBottom: SP.sm },
    rule: { paddingVertical: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    ruleTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text, marginBottom: 4 },
    body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.muted },
    bulletRow: { flexDirection: 'row', gap: SP.sm, paddingVertical: 4 },
    bullet: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.muted },
  });
}

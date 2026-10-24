/**
 * Brandthread — Buyer Payment Methods
 * Lists and manages saved Stripe payment methods, and adds a card without a
 * purchase (Stripe SetupIntent, components/payments/AddCardPanel).
 */
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { RetryRow } from '@/components/ui/RetryRow';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFocusEffect } from 'expo-router';

import { useApi } from '@/lib/api';

import { FONT, FS, SP } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { useAuth } from '@clerk/expo';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, Card, ErrorState, IconButton } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';

import { haptics } from '@/lib/haptics';
import { showAlert, confirmAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { stripePaymentAvailable } from '@/components/checkout/StripePayment';
import { AddCardPanel, ADD_CARD_UNAVAILABLE_COPY } from '@/components/payments/AddCardPanel';

import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII } from '@/constants/radii';

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
  funding?: string;
  country?: string;
  isDefault: boolean;
}

function CardBrand({ brand }: { brand: string }) {
  const { theme } = useAppTheme();
  const upper = brand.charAt(0).toUpperCase() + brand.slice(1);
  return (
    <View style={[cb.wrap, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
      <Text style={[cb.text, { color: theme.accent }]} numberOfLines={1}>{upper}</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  wrap: { borderRadius: RADII.chip, paddingHorizontal: SP.sm, paddingVertical: SP.xs, borderWidth: 1 },
  text: { fontSize: FS.xs, fontFamily: FONT.bold },
});

export default function BuyerPaymentMethodsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = React.useMemo(() => makeStyles(theme, palette), [theme, palette]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch is an error, never "No saved payment methods".
  const [loadError, setLoadError] = useState(false);
  const loadFailed = loadError;
  const [removing, setRemoving] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const { userId } = useAuth();
  const [addingCard, setAddingCard] = useState(false);
  // Stripe.js failed to load on web after the panel opened.
  const [stripeLoadFailed, setStripeLoadFailed] = useState(false);
  // In-app card entry needs a signed-in buyer, a dev/prod build with Stripe's
  // native module (not Expo Go) and a publishable key; never in the preview.
  const canAddCard = React.useMemo(
    () => !!userId && !isBuyerDevPreview() && stripePaymentAvailable(),
    [userId],
  ) && !stripeLoadFailed;

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    if (!userId) {
      setPaymentMethods([]);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const data = await api.reviews.paymentMethods() as any;
      if (!data || !Array.isArray(data.paymentMethods)) throw new Error('Unexpected payment methods response');
      setPaymentMethods(data.paymentMethods);
    } catch {
      setPaymentMethods([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [userId]));

  async function setDefault(pm: PaymentMethod) {
    if (pm.isDefault || settingDefault) return;
    setSettingDefault(pm.id);
    try {
      await api.reviews.setDefaultPaymentMethod(pm.id);
      setPaymentMethods(prev => prev.map(p => ({ ...p, isDefault: p.id === pm.id })));
    } catch (err) {
      showAlert("Couldn't set default card", friendlyError(err, 'Try again.'));
    } finally {
      setSettingDefault(null);
    }
  }

  async function confirmRemove(pm: PaymentMethod) {
    if (removing) return;
    const confirmed = await confirmAlert({
      title: 'Remove card',
      message: `Remove your ${pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ending in ${pm.last4}?`,
      confirmLabel: 'Remove card',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!confirmed) return;
    setRemoving(pm.id);
    try {
      await api.reviews.removePaymentMethod(pm.id) as any;
      setPaymentMethods(prev => prev.filter(p => p.id !== pm.id));
    } catch (err) {
      showAlert("Couldn't remove card", friendlyError(err, 'Try again.'));
    } finally {
      setRemoving(null);
    }
  }

  function onCardAdded() {
    setAddingCard(false);
    void load();
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Payment methods" />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : loadError ? (
        <ErrorState
          message="Couldn't load your payment methods. Check your connection and try again."
          onRetry={() => { void load(); }}
          style={{ flex: 1 }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.desc}>
            {canAddCard
              ? 'Cards you add here or use at checkout.'
              : 'Payment methods saved from your Brandthread purchases.'}
          </Text>

          {loadFailed ? (
            <View style={{ marginBottom: SPACING.xl }}>
              <RetryRow label="Couldn't load your saved cards" onRetry={() => void load()} />
            </View>
          ) : paymentMethods.length === 0 ? (
            <EmptyState
              icon="credit-card"
              title="No saved payment methods"
              compact
              style={{ marginBottom: SPACING.xl }}
            />
          ) : (
            <View style={s.card}>
              {paymentMethods.map((pm, i) => (
                <View key={pm.id}>
                  {i > 0 && <View style={s.rowDivider} />}
                  <View style={s.pmRow}>
                    <CardBrand brand={pm.brand} />
                    <View style={{ flex: 1 }}>
                      <View style={s.pmNameRow}>
                        <Text style={s.pmName}>•••• {pm.last4}</Text>
                        {pm.isDefault && (
                          <View style={s.defaultBadge}>
                            <Text style={s.defaultBadgeText}>Default</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.pmMeta}>
                        {pm.funding ? pm.funding.charAt(0).toUpperCase() + pm.funding.slice(1) + ' card' : 'Card'}
                        {pm.expMonth && pm.expYear ? ` · Exp ${String(pm.expMonth).padStart(2, '0')}/${String(pm.expYear).slice(-2)}` : ''}
                      </Text>
                      {!pm.isDefault && (
                        <Button
                          label="Set as default"
                          accessibilityLabel={`Set card ending in ${pm.last4} as default`}
                          onPress={() => setDefault(pm)}
                          variant="tertiary"
                          size="compact"
                          loading={settingDefault === pm.id}
                          disabled={settingDefault !== null}
                          style={s.setDefaultBtn}
                        />
                      )}
                    </View>
                    {removing === pm.id ? <ActivityIndicator size="small" color={palette.mutedForeground} /> : (
                      <IconButton
                        name="trash-2"
                        accessibilityLabel={`Remove card ending in ${pm.last4}`}
                        onPress={() => { void confirmRemove(pm); }}
                        variant="plain"
                        color={palette.mutedForeground}
                        disabled={settingDefault !== null}
                      />
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {!canAddCard ? (
            <Text style={s.addCardNote} testID="add-card-unavailable">{ADD_CARD_UNAVAILABLE_COPY}</Text>
          ) : addingCard ? (
            <AddCardPanel
              onAdded={onCardAdded}
              onCancel={() => setAddingCard(false)}
              onUnavailable={() => { setAddingCard(false); setStripeLoadFailed(true); }}
            />
          ) : (
            <Button
              label="Add card"
              icon="plus"
              onPress={() => setAddingCard(true)}
              variant="secondary"
              size="small"
              fullWidth
              disabled={settingDefault !== null || removing !== null}
              accessibilityHint="Opens a secure Stripe card form"
              style={s.addCardBtn}
              testID="add-card"
            />
          )}

          <View style={s.securityNote}>
            <Icon name="lock" size={14} color={palette.mutedForeground} style={{ marginTop: 1 }} />
            <Text style={s.securityNoteText}>
              Your payment information is encrypted and stored securely by Stripe. Brandthread cannot access your full card details.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme'], palette: ReturnType<typeof useColors>) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: 'transparent' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  body:    { paddingHorizontal: SPACING.md, paddingTop: SPACING.lg },
  desc:    { ...TYPE_SCALE.callout, color: palette.mutedForeground, lineHeight: 20, marginBottom: SPACING.lg },
  card:  { backgroundColor: palette.card, borderRadius: RADII.card, borderWidth: 1, borderColor: palette.border, overflow: 'hidden', marginBottom: SPACING.lg },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginHorizontal: SPACING.md },
  pmRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.md, paddingVertical: 14 },
  pmNameRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  pmName: { ...TYPE_SCALE.callout, fontFamily: FONT.semibold, color: palette.foreground },
  defaultBadge: { backgroundColor: `${theme.success}26`, borderRadius: RADII.pill, paddingHorizontal: SP.sm, paddingVertical: 3 },
  defaultBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.semibold, color: theme.success },
  pmMeta: { ...TYPE_SCALE.caption, color: palette.mutedForeground, marginTop: 2 },
  setDefaultBtn: { alignSelf: 'flex-start', marginTop: 2, minWidth: 0, paddingHorizontal: 0 },
  addCardBtn: { minHeight: 44, marginBottom: SPACING.lg },
  addCardNote: { ...TYPE_SCALE.caption, color: palette.mutedForeground, lineHeight: 18, marginBottom: SPACING.lg, paddingHorizontal: SPACING.sm },
  securityNote: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', paddingHorizontal: SPACING.sm },
  securityNoteText: { flex: 1, ...TYPE_SCALE.caption, color: palette.mutedForeground, lineHeight: 18 },
});

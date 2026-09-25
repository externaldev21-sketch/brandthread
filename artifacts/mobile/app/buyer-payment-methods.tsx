/**
 * Brandthread — Buyer Payment Methods
 * Lists and manages saved Stripe payment methods.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useApi } from '@/lib/api';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, Card, IconButton } from '@/components/ui';
import { EmptyState } from '@/components/BrandthreadUI';
import { hapticDestructiveConfirm, hapticLight, hapticWarning } from '@/lib/haptics';
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
      <Text style={[cb.text, { color: theme.accent }]}>{upper}</Text>
    </View>
  );
}
const cb = StyleSheet.create({
  wrap: { borderRadius: RADII.chip, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  text: { fontSize: 11, fontFamily: FONT.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
});

export default function BuyerPaymentMethodsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = React.useMemo(() => makeStyles(theme, palette), [theme, palette]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const { userId } = useAuth();

  const load = async () => {
    setLoading(true);
    if (!userId) {
      setPaymentMethods([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api.reviews.paymentMethods() as any;
      setPaymentMethods(data.paymentMethods ?? []);
    } catch {
      setPaymentMethods([]);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [userId]));

  async function setDefault(pm: PaymentMethod) {
    if (pm.isDefault || settingDefault) return;
    hapticLight();
    setSettingDefault(pm.id);
    try {
      await api.reviews.setDefaultPaymentMethod(pm.id);
      setPaymentMethods(prev => prev.map(p => ({ ...p, isDefault: p.id === pm.id })));
    } catch {
      Alert.alert('Error', 'Could not make this card your default. Please try again.');
    } finally {
      setSettingDefault(null);
    }
  }

  function confirmRemove(pm: PaymentMethod) {
    hapticWarning();
    Alert.alert(
      'Remove card',
      `Remove your ${pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ending in ${pm.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            hapticDestructiveConfirm();
            setRemoving(pm.id);
            try {
              await api.reviews.removePaymentMethod(pm.id) as any;
              setPaymentMethods(prev => prev.filter(p => p.id !== pm.id));
            } catch {
              Alert.alert('Error', 'Could not remove this card. Please try again.');
            } finally {
              setRemoving(null);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Payment methods" />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.desc}>
            Payment methods saved from your Brandthread purchases. Cards are stored securely by Stripe.
          </Text>

          {paymentMethods.length === 0 ? (
            <EmptyState
              icon="credit-card"
              title="No saved payment methods"
              description="Payment methods are saved automatically when you complete a purchase. Your card details are stored securely by Stripe — Brandthread never sees your full card number."
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
                          label="Make default"
                          onPress={() => setDefault(pm)}
                          variant="tertiary"
                          size="small"
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
                        onPress={() => confirmRemove(pm)}
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

          <View style={s.securityNote}>
            <Feather name="lock" size={14} color={palette.mutedForeground} style={{ marginTop: 1 }} />
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
  pmNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pmName: { ...TYPE_SCALE.callout, fontFamily: FONT.semibold, color: palette.foreground },
  defaultBadge: { backgroundColor: `${theme.success}26`, borderRadius: RADII.pill, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { ...TYPE_SCALE.caption, fontFamily: FONT.semibold, color: theme.success },
  pmMeta: { ...TYPE_SCALE.caption, color: palette.mutedForeground, marginTop: 2 },
  setDefaultBtn: { alignSelf: 'flex-start', marginTop: 6, minWidth: 0, paddingHorizontal: 0, height: 24 },
  securityNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: SPACING.sm },
  securityNoteText: { flex: 1, ...TYPE_SCALE.caption, color: palette.mutedForeground, lineHeight: 18 },
});

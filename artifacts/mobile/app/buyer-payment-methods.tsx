/**
 * Brandthread — Buyer Payment Methods
 * Lists and manages saved Stripe payment methods.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useApi } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

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

const BRAND_ICONS: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
  unionpay: '💳',
  jcb: '💳',
};

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
  wrap: { borderRadius: RADIUS.xs, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  text: { fontSize: 11, fontFamily: FONT.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
});

export default function BuyerPaymentMethodsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.reviews.paymentMethods() as any;
      setPaymentMethods(data.paymentMethods ?? []);
    } catch {
      setError('Could not load your payment methods. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  function confirmRemove(pm: PaymentMethod) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Remove card',
      `Remove your ${pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ending in ${pm.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
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
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Payment methods</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={30} color={MUTED} style={{ marginBottom: 12 }} />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={s.retryBtn} activeOpacity={0.7}>
            <Text style={s.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.desc}>
            Payment methods saved from your Brandthread purchases. Cards are stored securely by Stripe.
          </Text>

          {paymentMethods.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="credit-card" size={32} color={MUTED} style={{ marginBottom: 12 }} />
              <Text style={s.emptyTitle}>No saved payment methods</Text>
              <Text style={s.emptyDesc}>
                Payment methods are saved automatically when you complete a purchase. 
                Your card details are stored securely by Stripe — Brandthread never sees your full card number.
              </Text>
            </View>
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
                    </View>
                    {removing === pm.id ? (
                      <ActivityIndicator size="small" color={MUTED} />
                    ) : (
                      <TouchableOpacity onPress={() => confirmRemove(pm)} activeOpacity={0.7} style={s.removeBtn}>
                        <Feather name="trash-2" size={16} color={MUTED} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={s.securityNote}>
            <Feather name="lock" size={14} color={MUTED} style={{ marginTop: 1 }} />
            <Text style={s.securityNoteText}>
              Your payment information is encrypted and stored securely by Stripe. Brandthread cannot access your full card details.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  header:  { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  errorText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  retryBtn: { borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  body:    { paddingHorizontal: SP.md, paddingTop: SP.lg },
  desc:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20, marginBottom: SP.lg },
  emptyCard: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 40, paddingHorizontal: 30, marginBottom: SP.lg },
  emptyTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: 8 },
  emptyDesc:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 },
  card:  { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: SP.lg },
  rowDivider: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },
  pmRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SP.md, paddingVertical: 14 },
  pmNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pmName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  defaultBadge: { backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  defaultBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUCCESS },
  pmMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  removeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  securityNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: SP.sm },
  securityNoteText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 18 },
});

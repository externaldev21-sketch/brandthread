/** Creator program settings (seller). Route: /seller-creator-settings */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RetryRow } from '@/components/ui/RetryRow';
import { isSellerDevPreview } from '@/lib/devPreview';
import { EMPTY_SELLER_OVERVIEW, getPreviewSellerOverview } from '@/lib/previewAffiliate';
import { ActionButton } from '@/components/affiliate/AffiliateUI';

function Field({ label, value, onChange, suffix, help }: { label: string; value: string; onChange: (v: string) => void; suffix: string; help?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ marginBottom: SP.md }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.md, paddingHorizontal: SP.md, minHeight: 48 }}>
        <TextInput returnKeyType="done"
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={{ flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: theme.text }}
          accessibilityLabel={label}
        />
        <Text style={{ fontFamily: FONT.medium, color: theme.muted }}>{suffix}</Text>
      </View>
      {help ? <Text style={{ fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 4, lineHeight: 16 }}>{help}</Text> : null}
    </View>
  );
}

export default function SellerCreatorSettingsScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const previewOnly = isSellerDevPreview() && (!isLoaded || !isSignedIn);

  const [loading, setLoading] = useState(!previewOnly);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [commission, setCommission] = useState('10');
  const [discount, setDiscount] = useState('0');
  const [windowDays, setWindowDays] = useState('30');
  const [holdDays, setHoldDays] = useState('30');
  const [minPayout, setMinPayout] = useState('25');
  const [autoApprove, setAutoApprove] = useState(false);

  const load = useCallback(async () => {
    try {
      const { program } = previewOnly ? (getPreviewSellerOverview() ?? EMPTY_SELLER_OVERVIEW) : await api.affiliate.seller.overview();
      setCommission(String(program.commissionPercent));
      setDiscount(String(program.buyerDiscountPercent));
      setWindowDays(String(program.windowDays));
      setHoldDays(String(program.holdDays));
      setMinPayout(String(program.minPayoutCents / 100));
      setAutoApprove(program.autoApprove);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [api, previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async () => {
    const body = {
      commissionPercent: Number(commission),
      buyerDiscountPercent: Number(discount),
      windowDays: Number(windowDays),
      holdDays: Number(holdDays),
      minPayoutCents: Math.round(Number(minPayout) * 100),
      autoApprove,
    };
    if (Object.values(body).some((v) => typeof v === 'number' && !Number.isFinite(v))) { setMsg('Enter numbers in every field.'); return; }
    setSaving(true);
    try {
      if (!previewOnly) await api.affiliate.seller.saveProgram(body);
      router.back();
    } catch (e: any) { setMsg(e?.message ?? "Couldn't save."); }
    finally { setSaving(false); }
  };

  const s = useMemo(() => StyleSheet.create({ content: { paddingHorizontal: SP.md, paddingTop: SP.md } }), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Program settings" />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={theme.text} /> : error ? <RetryRow label="Couldn't load settings" onRetry={load} /> : (
          <>
            <Field label="Default commission" value={commission} onChange={setCommission} suffix="%" help="Paid on the item subtotal after discounts. Tax and shipping are excluded. Fractions of a cent round down." />
            <Field label="Buyer discount on creator codes" value={discount} onChange={setDiscount} suffix="%" help="0 keeps the code for tracking only." />
            <Field label="Attribution window" value={windowDays} onChange={setWindowDays} suffix="days" help="How long a clicked link keeps crediting the creator." />
            <Field label="Hold period" value={holdDays} onChange={setHoldDays} suffix="days" help="Days after delivery before commission becomes payable." />
            <Field label="Minimum payout" value={minPayout} onChange={setMinPayout} suffix="USD" />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.lg }}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text }}>Approve applications automatically</Text>
              <Switch value={autoApprove} onValueChange={setAutoApprove} trackColor={{ true: theme.success, false: theme.border }} accessibilityLabel="Approve applications automatically" />
            </View>
            {msg ? <Text style={{ fontFamily: FONT.medium, color: theme.error, marginBottom: SP.sm }}>{msg}</Text> : null}
            <ActionButton label="Save" loading={saving} onPress={save} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

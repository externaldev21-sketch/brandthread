/** Creator program settings (seller). Route: /seller-creator-settings */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { HapticSwitch } from '@/components/BrandthreadUI';
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
import { ActionButton, InlineError } from '@/components/affiliate/AffiliateUI';
import { friendlyError } from '@/lib/friendlyError';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { validateProgramSettings, type ProgramErrors, type ProgramField } from '@/lib/creatorProgramValidation';
import { CommissionStepper } from '@/components/affiliate/CommissionStepper';

function Field({ label, value, onChange, suffix, help, error }: { label: string; value: string; onChange: (v: string) => void; suffix: string; help?: string; error?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ marginBottom: SP.md }}>
      <Text style={{ fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: error ? theme.error : theme.border, backgroundColor: theme.card, borderRadius: RADIUS.md, paddingHorizontal: SP.md, minHeight: 48 }}>
        <TextInput returnKeyType="done"
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={{ flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: theme.text }}
          accessibilityLabel={label}
          accessibilityHint={error}
        />
        <Text style={{ fontFamily: FONT.medium, fontSize: FS.base, color: theme.muted }}>{suffix}</Text>
      </View>
      <InlineError message={error} />
      {help ? <Text style={{ fontFamily: FONT.regular, fontSize: FS.meta, color: theme.muted, marginTop: SP.xs, lineHeight: 16 }}>{help}</Text> : null}
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
  const [commission, setCommission] = useState(10);
  // The stored rate, so an unchanged commission isn't re-sent (a rate saved
  // before the 5–10% range existed must not block saving other settings).
  const [savedCommission, setSavedCommission] = useState(10);
  const [discount, setDiscount] = useState('0');
  const [windowDays, setWindowDays] = useState('30');
  const [holdDays, setHoldDays] = useState('30');
  const [minPayout, setMinPayout] = useState('25');
  const [autoApprove, setAutoApprove] = useState(false);
  const [errors, setErrors] = useState<ProgramErrors>({});
  // What was loaded, to tell whether anything has been edited.
  const [loaded, setLoaded] = useState<string | null>(null);
  const snapshot = JSON.stringify([commission, discount, windowDays, holdDays, minPayout, autoApprove]);
  const [saved, setSaved] = useState(false);
  // Not dirty while a save is in flight (the render during the request clears
  // the guard before the save's own router.back()) or once it has landed.
  const dirty = !saving && !saved && loaded != null && snapshot !== loaded;
  const onBack = useUnsavedChangesGuard(dirty);

  // Editing a field clears its own error, so a fixed value stops showing red.
  const edit = (field: ProgramField, set: (v: string) => void) => (v: string) => {
    set(v);
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const load = useCallback(async () => {
    try {
      const { program } = previewOnly ? (getPreviewSellerOverview() ?? EMPTY_SELLER_OVERVIEW) : await api.affiliate.seller.overview();
      setCommission(program.commissionPercent);
      setSavedCommission(program.commissionPercent);
      setDiscount(String(program.buyerDiscountPercent));
      setWindowDays(String(program.windowDays));
      setHoldDays(String(program.holdDays));
      setMinPayout(String(program.minPayoutCents / 100));
      setAutoApprove(program.autoApprove);
      setLoaded(JSON.stringify([
        program.commissionPercent, String(program.buyerDiscountPercent), String(program.windowDays),
        String(program.holdDays), String(program.minPayoutCents / 100), program.autoApprove,
      ]));
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [api, previewOnly]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async () => {
    setMsg(null);
    const checked = validateProgramSettings({ commission, savedCommission, discount, windowDays, holdDays, minPayout, autoApprove });
    if (!checked.ok) { setErrors(checked.errors); setMsg('Fix the highlighted fields to save.'); return; }
    setErrors({});
    setSaving(true);
    try {
      if (!previewOnly) await api.affiliate.seller.saveProgram(checked.body);
      setSaved(true);
      router.back();
    } catch (e) { setMsg(friendlyError(e, "Couldn't save your program settings. Try again.")); }
    finally { setSaving(false); }
  };

  const s = useMemo(() => StyleSheet.create({ content: { paddingHorizontal: SP.md, paddingTop: SP.md } }), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Program settings" onBack={onBack} />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={theme.text} /> : error ? <RetryRow label="Couldn't load settings" onRetry={load} /> : (
          <>
            <View style={{ marginBottom: SP.md }}>
              <CommissionStepper
                label="Default commission"
                value={commission}
                onChange={(v) => { setCommission(v); setErrors((e) => (e.commission ? { ...e, commission: undefined } : e)); }}
                testID="commission-stepper"
              />
              <InlineError message={errors.commission} />
              <Text style={{ fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 4, lineHeight: 14 }}>Paid on the item subtotal after discounts. Tax and shipping are excluded. Fractions of a cent round down. It comes out of your payout for that order before the creator is paid.</Text>
            </View>
            <Field label="Buyer discount on creator codes" value={discount} onChange={edit('discount', setDiscount)} error={errors.discount} suffix="%" help="0 keeps the code for tracking only." />
            <Field label="Attribution window" value={windowDays} onChange={edit('windowDays', setWindowDays)} error={errors.windowDays} suffix="days" help="How long a clicked link keeps crediting the creator." />
            <Field label="Hold period" value={holdDays} onChange={edit('holdDays', setHoldDays)} error={errors.holdDays} suffix="days" help="Days after delivery before commission becomes payable." />
            <Field label="Minimum payout" value={minPayout} onChange={edit('minPayout', setMinPayout)} error={errors.minPayout} suffix="USD" />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.lg }}>
              <Text style={{ fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text }}>Approve applications automatically</Text>
              <HapticSwitch value={autoApprove} onValueChange={setAutoApprove} trackColor={{ true: theme.success, false: theme.border }} accessibilityLabel="Approve applications automatically" />
            </View>
            <InlineError message={msg} style={{ marginTop: 0, marginBottom: SP.sm }} />
            <ActionButton label="Save" loading={saving} onPress={save} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

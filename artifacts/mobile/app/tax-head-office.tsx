/**
 * Tax regions → Head office. The business address Stripe Tax needs before it
 * can calculate tax. Opened from Tax regions, or from Taxes and duties when
 * turning automatic tax on finds no address (`?enable=1`: saving then turns
 * automatic tax on with this address). Reference: Shopify iOS store address.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP } from '@/lib/theme';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { FormInput, LoadingSkeleton, PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { DEMO_TAX_REGISTRATIONS, useTaxDemo, useTaxPreview } from '@/lib/taxScreens';
import {
  draftFromHeadOffice, headOfficeErrors, headOfficeFromDraft, setPendingTaxToast, type HeadOfficeDraft,
} from '@/lib/taxRegistrationsView';

export default function TaxHeadOfficeScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const tabBarMetrics = useTabBarMetrics(2);
  const isPreview = useTaxPreview();
  const demo = useTaxDemo();
  const params = useLocalSearchParams<{ enable?: string }>();
  const enabling = params.enable === '1';

  const [draft, setDraft] = useState<HeadOfficeDraft>(draftFromHeadOffice(null));
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isPreview) {
      if (demo) setDraft(draftFromHeadOffice(DEMO_TAX_REGISTRATIONS.headOffice));
      setLoading(false);
      return;
    }
    try {
      const info = await api.taxes.registrations();
      setDraft(draftFromHeadOffice(info.headOffice));
    } catch { /* start from an empty form */ }
    setLoading(false);
  }, [api, isPreview, demo]);

  useEffect(() => { void load(); }, [load]);

  const errors = submitted ? headOfficeErrors(draft) : {};
  const set = (key: keyof HeadOfficeDraft) => (value: string) => { setDraft((d) => ({ ...d, [key]: value })); setSaveError(null); };
  const goBack = () => goBackOr(router, (enabling ? '/taxes-duties' : '/tax-regions') as never);

  async function save() {
    setSubmitted(true);
    if (Object.keys(headOfficeErrors(draft)).length > 0 || saving || isPreview) return;
    setSaving(true);
    setSaveError(null);
    try {
      const address = headOfficeFromDraft(draft);
      if (enabling) await api.taxes.enable(address);
      else await api.taxes.setHeadOffice(address);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPendingTaxToast(enabling ? 'Automatic tax turned on' : 'Head office saved');
      goBack();
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setSaveError(
        error instanceof ApiError && error.status < 500 && error.message
          ? error.message
          : "Couldn't save your head office. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Head office" onBack={goBack} />
      {loading ? (
        <View style={styles.content}>{[0, 1, 2, 3].map((i) => <LoadingSkeleton key={i} height={56} style={{ marginBottom: SP.sm }} />)}</View>
      ) : (
        <KeyboardAwareScrollViewCompat
          style={{ marginBottom: tabBarMetrics.occupiedHeight }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <FormInput label="Street address" value={draft.line1} onChange={set('line1')} error={errors.line1} returnKeyType="next" />
          <FormInput label="Apartment, suite (optional)" value={draft.line2} onChange={set('line2')} returnKeyType="next" />
          <FormInput label="City" value={draft.city} onChange={set('city')} error={errors.city} returnKeyType="next" />
          <View style={styles.pair}>
            <FormInput label="State" value={draft.state} onChange={set('state')} error={errors.state} style={styles.half} returnKeyType="next" />
            <FormInput label="ZIP code" value={draft.postalCode} onChange={set('postalCode')} error={errors.postalCode} style={styles.half} returnKeyType="next" />
          </View>
          <FormInput label="Country" value={draft.country} onChange={set('country')} error={errors.country} returnKeyType="done" onSubmitEditing={() => { void save(); }} />
          {saveError && <Text style={styles.error} accessibilityLiveRegion="polite">{saveError}</Text>}
          <PrimaryButton
            label={enabling ? 'Save and turn on tax' : 'Save'}
            onPress={() => { void save(); }}
            loading={saving}
            disabled={saving}
            style={{ marginTop: SP.sm }}
            testID="tax-head-office-save"
          />
        </KeyboardAwareScrollViewCompat>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: SP.md, paddingBottom: SP.lg, gap: 4 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  error: { color: theme.error, fontSize: FS.sm, fontFamily: FONT.medium, marginTop: SP.xs },
});

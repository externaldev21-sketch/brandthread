import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hapticToggle } from '@/lib/haptics';
import { ListRow } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { RetryRow } from '@/components/ui/RetryRow';
import { SPACING } from '@/constants/spacing';
import { FONT, FS } from '@/lib/theme';
import {
  DEFAULT_CUSTOMER_PRIVACY, normalizeCustomerPrivacy, type CustomerPrivacySettings,
} from '@/lib/customerPrivacy';

/**
 * Customer privacy — real, persisted settings (seller_settings.customerPrivacy
 * via GET/PATCH /api/seller/settings) plus links to the existing screens that
 * handle the rest of customer data: store privacy policy and data export.
 *
 * "Hide contact details in exports" is enforced server-side by
 * POST /api/seller/export (api-server lib/customerPrivacySettings.ts).
 */
export default function CustomerPrivacyScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const [settings, setSettings] = useState<CustomerPrivacySettings>(DEFAULT_CUSTOMER_PRIVACY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.seller.getSettings();
      setSettings(normalizeCustomerPrivacy(data?.settings?.customerPrivacy));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function update(patch: Partial<CustomerPrivacySettings>) {
    hapticToggle();
    const prior = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaveError(false);
    try {
      const result = await api.seller.updateSettings({ customerPrivacy: next });
      setSettings(normalizeCustomerPrivacy(result?.settings?.customerPrivacy ?? next));
    } catch {
      setSettings(prior);
      setSaveError(true);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer privacy" onBack={() => goBackOr(router, '/seller-settings')} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : loadError ? (
        <View style={s.center}><RetryRow label="Couldn't load privacy settings" onRetry={() => void load()} /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
          <View style={s.section}>
            <Card>
              <ListRow
                icon="eye-off"
                title="Hide contact details in exports"
                subtitle="Leave customer emails, phone numbers and addresses out of store data exports"
                subtitleNumberOfLines={2}
                toggle={{ value: settings.maskContactInExports, onChange: (v) => void update({ maskContactInExports: v }) }}
              />
            </Card>
            {saveError && (
              <Text style={[s.note, { color: colors.destructive }]}>Couldn{'’'}t save that change. Check your connection and try again.</Text>
            )}
          </View>

          <View style={s.section}>
            <Card>
              <ListRow
                icon="file-text"
                title="Privacy policy"
                subtitle="The policy buyers see on your store"
                subtitleNumberOfLines={1}
                chevron
                onPress={() => router.push('/store-policies' as never)}
              />
              <View style={[s.rowDivider, { backgroundColor: colors.border }]} />
              <ListRow
                icon="download"
                title="Export store data"
                subtitle="Products, orders and customers"
                subtitleNumberOfLines={1}
                chevron
                onPress={() => router.push('/seller-data-export' as never)}
              />
            </Card>
            <Text style={[s.note, { color: colors.mutedForeground }]}>
              Buyers can download a copy of their own data or delete their account from their account settings.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1 },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  section:    { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md + 2 },
  rowDivider: { height: StyleSheet.hairlineWidth },
  note:       { fontSize: FS.xs, fontFamily: FONT.regular, lineHeight: 16, marginTop: SPACING.sm, paddingHorizontal: 2 },
});

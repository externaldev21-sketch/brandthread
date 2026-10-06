/**
 * Checkout settings (seller). Saved to the store's settings as soon as they
 * change (PATCH /api/seller/settings, like the Languages screen) and enforced
 * at checkout by the API (api-server lib/sellerCheckoutSettings.ts):
 *  - "Accounts required" turns guest checkout off for this store;
 *  - tipping adds a tip choice to the buyer's in-app checkout, charged and
 *    paid out with the order.
 * The checkout language is the store language set on the Languages screen.
 * The signed-out seller web preview never calls the API; changes stay local.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import {
  DEFAULT_SELLER_CHECKOUT_SETTINGS, checkoutModeOption, nextCheckoutMode, sellerCheckoutSettingsFrom, storeLanguageName,
  type SellerCheckoutSettings,
} from '@/lib/checkoutSettings';

export default function CheckoutScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const previewOnly = isSellerDevPreview();
  const [settings, setSettings] = useState<SellerCheckoutSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const settingsRef = useRef<SellerCheckoutSettings | null>(null);
  settingsRef.current = settings;

  const load = useCallback(async () => {
    setLoadFailed(false);
    if (previewOnly) {
      setSettings(prev => prev ?? { ...DEFAULT_SELLER_CHECKOUT_SETTINGS });
      return;
    }
    try {
      const data = await api.seller.getSettings();
      setSettings(sellerCheckoutSettingsFrom(data?.settings));
    } catch {
      if (!settingsRef.current) setLoadFailed(true);
    }
  }, [api, previewOnly]);

  // Reloads on focus so a store language changed on the Languages screen shows here.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function save(patch: Partial<Pick<SellerCheckoutSettings, 'checkoutMode' | 'tippingEnabled'>>) {
    const prior = settingsRef.current;
    if (!prior) return;
    haptic();
    setSettings({ ...prior, ...patch });
    if (previewOnly) return;
    try {
      const result = await api.seller.updateSettings(patch);
      if (result?.settings) setSettings(sellerCheckoutSettingsFrom(result.settings));
    } catch {
      setSettings(prior);
      Alert.alert('Could not save', 'Your checkout settings were not changed. Try again.');
    }
  }

  function cycleMode() {
    if (!settings) return;
    void save({ checkoutMode: nextCheckoutMode(settings.checkoutMode) });
  }

  if (!settings) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Checkout settings" />
        {loadFailed ? (
          <View style={styles.section}>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              We couldn't load your checkout settings. Check your connection and try again.
            </Text>
            <TouchableOpacity onPress={() => { void load(); }} activeOpacity={0.7} style={[styles.selectBox, { borderColor: colors.border }]}>
              <Text style={[styles.selectValue, { color: colors.foreground }]}>Try again</Text>
              <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}><ActivityIndicator color={colors.primary} /></View>
        )}
      </View>
    );
  }

  const mode = checkoutModeOption(settings.checkoutMode);
  const tipping = settings.tippingEnabled;

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Checkout settings" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <TouchableOpacity
            onPress={cycleMode}
            activeOpacity={0.7}
            style={[styles.selectBox, { borderColor: colors.border, marginBottom: 12 }]}
            accessibilityRole="button"
            accessibilityLabel={`Checkout mode: ${mode.label}`}
            accessibilityHint="Switches between accounts optional and accounts required"
          >
            <Text style={[styles.selectValue, { color: colors.foreground }]}>{mode.label}</Text>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>{mode.description}</Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tipping</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Customers can choose between 3 presets or enter a custom amount
          </Text>
          <TouchableOpacity
            onPress={() => { void save({ tippingEnabled: !tipping }); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tipping }}
            activeOpacity={0.7}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: tipping ? colors.primary : colors.border, backgroundColor: tipping ? colors.primary : 'transparent' },
              ]}
            >
              {tipping && <Feather name="check" size={12} color={colors.primaryForeground} />}
            </View>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Show tipping options at checkout</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Checkout language</Text>
          <TouchableOpacity
            onPress={() => router.push('/languages' as never)}
            activeOpacity={0.7}
            style={[styles.langRow, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={`Checkout language: ${storeLanguageName(settings.storeLanguage)}`}
            accessibilityHint="Opens your store language settings"
          >
            <Text style={[styles.langText, { color: colors.foreground }]}>{storeLanguageName(settings.storeLanguage)}</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: SP.md, paddingVertical: SP.md + 2 },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.semibold, marginBottom: SP.xs + 2 },
  sectionSubtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.md - 2, lineHeight: 17 },
  divider: { height: SP.sm + 2 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  selectBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md - 2 },
  selectValue: { fontSize: FS.md, fontFamily: FONT.semibold },
  cardTitle: { fontSize: FS.md, fontFamily: FONT.semibold },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, marginTop: SP.xs },
  checkbox: { width: 18, height: 18, borderRadius: RADIUS.xs - 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md - 2, gap: SP.sm + 2 },
  langText: { fontSize: FS.md, fontFamily: FONT.medium },
});

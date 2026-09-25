import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, ScrollView, TextInput,
  StyleSheet, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  SUCCESS, BLUE, ORANGE, RED,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SectionHeader, FilterChip, PressableScale,
} from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListRow } from '@/components/ui/ListRow';
import { hapticToggle } from '@/lib/haptics';
import { getStorefront, updateSettings } from '@/services/storeService';
import { Storefront, StoreSettings, StorePublishStatus } from '@/services/storeTypes';

type Colors = ReturnType<typeof useColors>;

const STATUS_OPTIONS: { value: StorePublishStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'password_protected', label: 'Password Protected' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'unpublished', label: 'Unpublished' },
];

function statusColor(st: StorePublishStatus, mutedColor: string): string {
  if (st === 'published') return SUCCESS;
  if (st === 'draft') return BLUE;
  if (st === 'password_protected') return ORANGE;
  if (st === 'maintenance') return ORANGE;
  if (st === 'unpublished') return RED;
  return mutedColor;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
const LANGUAGES = ['English', 'Spanish', 'French', 'Portuguese', 'Japanese'];
const MEASUREMENTS: { value: 'imperial' | 'metric'; label: string }[] = [
  { value: 'imperial', label: 'Imperial' },
  { value: 'metric', label: 'Metric' },
];

function langCode(label: string): string {
  const map: Record<string, string> = {
    English: 'en', Spanish: 'es', French: 'fr', Portuguese: 'pt', Japanese: 'ja',
  };
  return map[label] ?? 'en';
}
function langLabel(code: string): string {
  const map: Record<string, string> = {
    en: 'English', es: 'Spanish', fr: 'French', pt: 'Portuguese', ja: 'Japanese',
  };
  return map[code] ?? 'English';
}

export default function StoreSettingsScreen() {
  const colors = useColors();
  const ss = React.useMemo(() => makeStyles(colors), [colors]);
  const [form, setForm] = useState<StoreSettings>({
    storeName: '',
    storeUrl: '',
    contactEmail: '',
    supportEmail: '',
    currency: 'USD',
    language: 'en',
    timezone: 'America/New_York',
    measurementUnit: 'imperial',
    storeStatus: 'draft',
    passwordProtected: false,
    storePassword: '',
    checkoutRequireAccount: false,
    checkoutGuestAllowed: true,
    orderNotifications: true,
    analyticsEnabled: false,
  });
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    getStorefront().then(s => {
      setForm(s.settings);
    });
  }, []));

  const patch = (partial: Partial<StoreSettings>) => setForm(f => ({ ...f, ...partial }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings(form);
      Alert.alert('Saved', 'Store settings updated.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={ss.root}>
      <ScreenHeader
        title="Store Settings"
        variant="push"
        rightElement={(
          <PrimaryButton
            label={saving ? 'Saving...' : 'Save'}
            onPress={handleSave}
            loading={saving}
            small
            style={{ minWidth: 72 }}
          />
        )}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ss.scroll}>

        {/* STORE IDENTITY */}
        <SectionHeader title="STORE IDENTITY" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <FieldRow ss={ss} label="Store Name">
            <TextInput
              style={ss.input}
              value={form.storeName}
              onChangeText={v => patch({ storeName: v })}
              placeholder="Your Brand Name"
              placeholderTextColor={colors.mutedForeground}
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Store URL">
            <View style={ss.urlRow}>
              <TextInput
                style={[ss.input, { flex: 1 }]}
                value={form.storeUrl}
                onChangeText={v => patch({ storeUrl: v })}
                placeholder="yourstore"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
              />
              <Text style={ss.urlSuffix}>.brandthread.app</Text>
            </View>
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Contact Email">
            <TextInput
              style={ss.input}
              value={form.contactEmail}
              onChangeText={v => patch({ contactEmail: v })}
              placeholder="you@brand.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Customer Support Email">
            <TextInput
              style={ss.input}
              value={form.supportEmail}
              onChangeText={v => patch({ supportEmail: v })}
              placeholder="support@brand.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </FieldRow>
        </BrandthreadCard>

        {/* LOCALIZATION */}
        <SectionHeader title="LOCALIZATION" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <FieldRow ss={ss} label="Currency">
            <View style={ss.chipRow}>
              {CURRENCIES.map(c => (
                <FilterChip key={c} label={c} active={form.currency === c} onPress={() => patch({ currency: c })} />
              ))}
            </View>
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Language">
            <View style={ss.chipRow}>
              {LANGUAGES.map(l => (
                <FilterChip
                  key={l}
                  label={l}
                  active={langLabel(form.language) === l}
                  onPress={() => patch({ language: langCode(l) })}
                />
              ))}
            </View>
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Time Zone">
            <TextInput
              style={ss.input}
              value={form.timezone}
              onChangeText={v => patch({ timezone: v })}
              placeholder="America/New_York"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow ss={ss} label="Measurement">
            <View style={ss.chipRow}>
              {MEASUREMENTS.map(m => (
                <FilterChip key={m.value} label={m.label} active={form.measurementUnit === m.value} onPress={() => patch({ measurementUnit: m.value })} />
              ))}
            </View>
          </FieldRow>
        </BrandthreadCard>

        {/* STORE STATUS */}
        <SectionHeader title="STORE STATUS" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <View style={ss.chipRow}>
            {STATUS_OPTIONS.map(opt => {
              const isActive = form.storeStatus === opt.value;
              const chipColor = statusColor(opt.value, colors.mutedForeground);
              return (
                <PressableScale
                  key={opt.value}
                  onPress={() => {
                    hapticToggle();
                    patch({ storeStatus: opt.value, passwordProtected: opt.value === 'password_protected' });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: isActive }}
                  style={[ss.statusChip, isActive && { borderColor: chipColor, backgroundColor: chipColor + '20' }]}
                >
                  <Text style={[ss.statusChipLabel, { color: isActive ? chipColor : colors.mutedForeground }]}>{opt.label}</Text>
                </PressableScale>
              );
            })}
          </View>
          {form.storeStatus === 'password_protected' && (
            <>
              <View style={ss.divider} />
              <FieldRow ss={ss} label="Store Password">
                <TextInput
                  style={ss.input}
                  value={form.storePassword ?? ''}
                  onChangeText={v => patch({ storePassword: v })}
                  placeholder="Store access password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                />
              </FieldRow>
            </>
          )}
        </BrandthreadCard>

        {/* CHECKOUT & ACCOUNTS */}
        <SectionHeader title="CHECKOUT & ACCOUNTS" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <SwitchRow
            label="Require Account"
            description="Buyers must create an account to check out"
            value={form.checkoutRequireAccount}
            onValueChange={v => patch({ checkoutRequireAccount: v })}
          />
          <View style={ss.divider} />
          <SwitchRow
            label="Guest Checkout"
            description="Allow guest checkout"
            value={form.checkoutGuestAllowed}
            onValueChange={v => patch({ checkoutGuestAllowed: v })}
          />
          <View style={ss.divider} />
          <SwitchRow
            label="Order Notifications"
            description="Email seller on new orders"
            value={form.orderNotifications}
            onValueChange={v => patch({ orderNotifications: v })}
          />
          <View style={ss.divider} />
          <SwitchRow
            label="Analytics"
            description="Enable analytics tracking"
            value={form.analyticsEnabled}
            onValueChange={v => patch({ analyticsEnabled: v })}
          />
        </BrandthreadCard>

        <PrimaryButton label="Save Settings" onPress={handleSave} loading={saving} style={ss.saveBtn} />
      </ScrollView>
    </View>
  );
}

function FieldRow({ ss, label, children }: { ss: ReturnType<typeof makeStyles>; label: string; children: React.ReactNode }) {
  return (
    <View style={ss.fieldRow}>
      <Text style={ss.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function SwitchRow({ label, description, value, onValueChange }: {
  label: string; description: string; value: boolean; onValueChange: (v: boolean) => void;
}) {
  return (
    <ListRow
      title={label}
      subtitle={description}
      toggle={{ value, onChange: onValueChange }}
      style={{ minHeight: 48 }}
    />
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    scroll: { paddingBottom: 60 },
    sectionHeader: { marginTop: SP.lg, marginBottom: SP.sm },
    card: { marginHorizontal: SP.md, gap: SP.md },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    fieldRow: { gap: 6 },
    fieldLabel: { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.semibold, color: colors.mutedForeground },
    input: {
      fontSize: FS.base, lineHeight: 19, fontFamily: FONT.regular, color: colors.foreground,
      backgroundColor: colors.secondary, borderRadius: RADIUS.sm,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: SP.md, paddingVertical: 10,
      minHeight: 44,
    },
    urlRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    urlSuffix: { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.medium, color: colors.mutedForeground },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    statusChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill,
      borderWidth: 1, borderColor: colors.border,
      minHeight: 30, justifyContent: 'center',
    },
    statusChipLabel: { fontSize: FS.sm, lineHeight: 17, fontFamily: FONT.medium },
    saveBtn: { marginHorizontal: SP.md, marginTop: SP.lg },
  });
}

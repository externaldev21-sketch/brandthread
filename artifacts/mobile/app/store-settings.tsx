import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, ScrollView, Switch, TextInput,
  StyleSheet, Alert, TouchableOpacity,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import {
  BG, SURFACE, CARD, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  SUCCESS, BLUE, ORANGE, RED,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SectionHeader, FilterChip,
} from '@/components/BrandthreadUI';
import { getStorefront, updateSettings } from '@/services/storeService';
import { Storefront, StoreSettings, StorePublishStatus } from '@/services/storeTypes';

const STATUS_OPTIONS: { value: StorePublishStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'password_protected', label: 'Password Protected' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'unpublished', label: 'Unpublished' },
];

function statusColor(st: StorePublishStatus): string {
  if (st === 'published') return SUCCESS;
  if (st === 'draft') return BLUE;
  if (st === 'password_protected') return ORANGE;
  if (st === 'maintenance') return ORANGE;
  if (st === 'unpublished') return RED;
  return MUTED;
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
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const headerTopInset = useHeaderTopInset();
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
      {/* Header */}
      <View style={[ss.header, { paddingTop: headerTopInset + SP.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={ss.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Store Settings</Text>
        <PrimaryButton
          label={saving ? 'Saving...' : 'Save'}
          onPress={handleSave}
          loading={saving}
          small
          style={{ minWidth: 72 }}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ss.scroll}>

        {/* STORE IDENTITY */}
        <SectionHeader title="STORE IDENTITY" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <FieldRow label="Store Name">
            <TextInput
              style={ss.input}
              value={form.storeName}
              onChangeText={v => patch({ storeName: v })}
              placeholder="Your Brand Name"
              placeholderTextColor={SUBTLE}
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow label="Store URL">
            <View style={ss.urlRow}>
              <TextInput
                style={[ss.input, { flex: 1 }]}
                value={form.storeUrl}
                onChangeText={v => patch({ storeUrl: v })}
                placeholder="yourstore"
                placeholderTextColor={SUBTLE}
                autoCapitalize="none"
              />
              <Text style={ss.urlSuffix}>.brandthread.app</Text>
            </View>
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow label="Contact Email">
            <TextInput
              style={ss.input}
              value={form.contactEmail}
              onChangeText={v => patch({ contactEmail: v })}
              placeholder="you@brand.com"
              placeholderTextColor={SUBTLE}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow label="Customer Support Email">
            <TextInput
              style={ss.input}
              value={form.supportEmail}
              onChangeText={v => patch({ supportEmail: v })}
              placeholder="support@brand.com"
              placeholderTextColor={SUBTLE}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </FieldRow>
        </BrandthreadCard>

        {/* LOCALIZATION */}
        <SectionHeader title="LOCALIZATION" style={ss.sectionHeader} />
        <BrandthreadCard style={ss.card}>
          <FieldRow label="Currency">
            <View style={ss.chipRow}>
              {CURRENCIES.map(c => (
                <FilterChip key={c} label={c} active={form.currency === c} onPress={() => patch({ currency: c })} />
              ))}
            </View>
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow label="Language">
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
          <FieldRow label="Time Zone">
            <TextInput
              style={ss.input}
              value={form.timezone}
              onChangeText={v => patch({ timezone: v })}
              placeholder="America/New_York"
              placeholderTextColor={SUBTLE}
              autoCapitalize="none"
            />
          </FieldRow>
          <View style={ss.divider} />
          <FieldRow label="Measurement">
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
              const chipColor = statusColor(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => patch({ storeStatus: opt.value, passwordProtected: opt.value === 'password_protected' })}
                  style={[ss.statusChip, isActive && { borderColor: chipColor, backgroundColor: chipColor + '20' }]}
                >
                  <Text style={[ss.statusChipLabel, { color: isActive ? chipColor : MUTED }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {form.storeStatus === 'password_protected' && (
            <>
              <View style={ss.divider} />
              <FieldRow label="Store Password">
                <TextInput
                  style={ss.input}
                  value={form.storePassword ?? ''}
                  onChangeText={v => patch({ storePassword: v })}
                  placeholder="Store access password"
                  placeholderTextColor={SUBTLE}
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
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
    <View style={ss.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={ss.switchLabel}>{label}</Text>
        <Text style={ss.switchDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: 'rgba(255,255,255,0.1)', true: PURPLE }}
        thumbColor={FG}
      />
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, flex: 1, marginLeft: SP.sm },
  scroll: { paddingBottom: 60 },
  sectionHeader: { marginTop: SP.lg, marginBottom: SP.sm },
  card: { marginHorizontal: SP.md, gap: SP.md },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  fieldRow: { gap: 6 },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  urlSuffix: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  statusChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  statusChipLabel: { fontSize: FS.sm, fontFamily: FONT.medium },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  switchDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  saveBtn: { marginHorizontal: SP.md, marginTop: SP.lg },
});

/** Seller email sender details (name, reply-to, mailing address, double opt-in). Route: /email-settings */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailSettings } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { Field, SolidButton } from '@/components/email/EmailUI';
import { DEMO_SETTINGS, EMPTY_SETTINGS, emailMode } from '@/lib/emailMarketing';
import { FONT, FS } from '@/lib/theme';

export default function EmailSettingsScreen() {
  const c = useColors();
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<EmailSettings | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const mode = emailMode();

  const load = useCallback(() => {
    if (mode !== 'live') { setForm(mode === 'demo' ? DEMO_SETTINGS : EMPTY_SETTINGS); return; }
    api.emailMarketing.settings().then((s) => { setForm(s); setError(false); }).catch(() => setError(true));
  }, [api, mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!form) return;
    if (mode !== 'live') { router.back(); return; }
    setSaving(true);
    try {
      await api.emailMarketing.saveSettings({
        fromName: form.fromName, replyTo: form.replyTo, postalAddress: form.postalAddress, doubleOptIn: form.doubleOptIn,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Not saved', typeof e?.message === 'string' && e.message.length < 120 ? e.message : "Couldn't save your sender details.");
    } finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Sender details" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 140 }} keyboardShouldPersistTaps="handled">
        {error ? <RetryRow label="Couldn't load sender details" onRetry={load} /> : !form ? (
          <ActivityIndicator color={c.foreground} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Field label="Sender name" value={form.fromName} max={70} placeholder={form.defaultFromName} onChangeText={(t) => setForm({ ...form, fromName: t })} />
            <Field label="Reply-to email" value={form.replyTo} autoCapitalize="none" keyboardType="email-address" placeholder="hello@yourstore.com" onChangeText={(t) => setForm({ ...form, replyTo: t })} />
            <Field label="Mailing address" value={form.postalAddress} max={300} multiline placeholder="Street, city, region, postal code" onChangeText={(t) => setForm({ ...form, postalAddress: t })} />
            <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, marginTop: -8, marginBottom: 20 }}>
              Required by email law. It appears at the bottom of every email you send.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: FONT.semibold, fontSize: FS.md }}>Confirm new subscribers by email</Text>
                <Text style={{ color: c.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 }}>
                  New signups receive a confirmation link and join your list once they click it.
                </Text>
              </View>
              <HapticSwitch value={form.doubleOptIn} onValueChange={(v: boolean) => setForm({ ...form, doubleOptIn: v })} accessibilityLabel="Confirm new subscribers by email" />
            </View>
            <View style={{ marginTop: 28 }}><SolidButton label="Save" onPress={save} loading={saving} /></View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

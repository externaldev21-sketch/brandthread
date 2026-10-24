/** Seller email sender details (name, reply-to, mailing address, double opt-in). Route: /email-settings */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApi, type EmailSettings } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { Field, SolidButton } from '@/components/email/EmailUI';
import { DEMO_SETTINGS, EMPTY_SETTINGS, emailMode } from '@/lib/emailMarketing';
import { FONT, FS, SP } from '@/lib/theme';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { friendlyError } from '@/lib/friendlyError';

const editable = (s: EmailSettings) => JSON.stringify([s.fromName, s.replyTo, s.postalAddress, s.doubleOptIn]);

export default function EmailSettingsScreen() {
  const c = useColors();
  const api = useApi();
  const router = useRouter();
  const [form, setForm] = useState<EmailSettings | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Values as last loaded or saved, to tell whether leaving would drop edits.
  const [saved, setSaved] = useState<string | null>(null);
  // Set after a save so the back navigation runs once the guard sees a clean form.
  const [leave, setLeave] = useState(false);
  const mode = emailMode();

  const load = useCallback(() => {
    const apply = (s: EmailSettings) => { setForm(s); setSaved(editable(s)); };
    if (mode !== 'live') { apply(mode === 'demo' ? DEMO_SETTINGS : EMPTY_SETTINGS); return; }
    api.emailMarketing.settings().then((s) => { apply(s); setError(false); }).catch(() => setError(true));
  }, [api, mode]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const dirty = !!form && saved !== null && editable(form) !== saved;
  const onBack = useUnsavedChangesGuard(dirty);
  useEffect(() => {
    if (!leave) return;
    setLeave(false);
    router.back();
  }, [leave, router]);

  const save = async () => {
    if (!form) return;
    if (form.replyTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.replyTo.trim())) {
      Alert.alert('Check your reply-to email', 'Enter a full email address, like hello@yourstore.com.');
      return;
    }
    if (mode !== 'live') { setSaved(editable(form)); setLeave(true); return; }
    setSaving(true);
    try {
      await api.emailMarketing.saveSettings({
        fromName: form.fromName, replyTo: form.replyTo, postalAddress: form.postalAddress, doubleOptIn: form.doubleOptIn,
      });
      setSaved(editable(form));
      setLeave(true);
    } catch (e: any) {
      Alert.alert('Not saved', friendlyError(e, "Couldn't save your sender details."));
    } finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Sender details" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: SP.xl }} keyboardShouldPersistTaps="handled">
        {error ? <RetryRow label="Couldn't load sender details" onRetry={load} /> : !form ? (
          <ActivityIndicator color={c.foreground} style={{ marginTop: 32 }} />
        ) : (
          <>
            <Field label="Sender name" value={form.fromName} max={70} placeholder={form.defaultFromName} onChangeText={(t) => setForm({ ...form, fromName: t })} />
            <Field label="Reply-to email" value={form.replyTo} autoCapitalize="none" keyboardType="email-address" placeholder="hello@yourstore.com" onChangeText={(t) => setForm({ ...form, replyTo: t })} />
            <Field label="Mailing address" value={form.postalAddress} max={300} multiline placeholder="Street, city, region, postal code" onChangeText={(t) => setForm({ ...form, postalAddress: t })}
              hint="Required by email law. It appears at the bottom of every email you send." />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SP.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: FONT.semibold, fontSize: FS.sm }}>Confirm new subscribers by email</Text>
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

/**
 * Seller > Messages > Away message — the automatic reply a buyer gets when
 * they message while the seller is away (always-on, or outside business
 * hours in the seller's timezone). Route: /away-message
 *
 * Distinct from Vacation Mode (app/vacation-mode.tsx), which pauses orders
 * and blocks new messages; the away message lets messages through and
 * answers them once per conversation per away window.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi, type SellerAwaySettings } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { haptics } from '@/lib/haptics';
import { isSellerDevPreview } from '@/lib/devPreview';
import { apiErrorMessage } from '@/lib/safety';
import { formatMinute, parseMinute } from '@/lib/awayHours';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';

const MESSAGE_MAX = 1000;
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function deviceTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const DEFAULTS: SellerAwaySettings = {
  enabled: false, message: '', mode: 'always', timezone: 'UTC',
  openDays: 62, openMinute: 540, closeMinute: 1020,
};

export default function AwayMessageScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const offline = !userId || isSellerDevPreview();

  const [loading, setLoading] = useState(!offline);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<SellerAwaySettings>({ ...DEFAULTS, timezone: deviceTimezone() });
  const [openText, setOpenText] = useState(formatMinute(DEFAULTS.openMinute));
  const [closeText, setCloseText] = useState(formatMinute(DEFAULTS.closeMinute));

  const load = useCallback(async () => {
    if (offline) { setLoading(false); return; }
    try {
      const res = await api.seller.awayMessage.get();
      // A never-saved row comes back as UTC — prefer the device's timezone.
      const tz = res.message || res.enabled ? res.timezone : deviceTimezone();
      setForm({ ...res, timezone: tz });
      setOpenText(formatMinute(res.openMinute));
      setCloseText(formatMinute(res.closeMinute));
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load your away message.'));
    } finally {
      setLoading(false);
    }
  }, [api, offline]);

  useEffect(() => { void load(); }, [load]);

  const patch = (p: Partial<SellerAwaySettings>) => { setSaved(false); setForm((f) => ({ ...f, ...p })); };

  async function save() {
    const openMinute = parseMinute(openText);
    const closeMinute = parseMinute(closeText);
    if (form.mode === 'outside_hours' && (openMinute == null || closeMinute == null)) {
      setError('Enter hours like 09:00 and 17:00.');
      return;
    }
    if (form.enabled && !form.message.trim()) {
      setError('Write an away message before turning it on.');
      return;
    }
    const body: SellerAwaySettings = {
      ...form,
      message: form.message.trim(),
      openMinute: openMinute ?? form.openMinute,
      closeMinute: closeMinute ?? form.closeMinute,
    };
    setSaving(true); setError(null);
    try {
      if (!offline) await api.seller.awayMessage.update(body);
      setForm(body);
      haptics.success();
      setSaved(true);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save your away message.'));
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle = { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground };

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Away message" onBack={() => goBackOr(router, '/seller-inbox')} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]} testID="away-message-toggle">
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Send away message</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>Buyers get it once when they message you</Text>
            </View>
            <HapticSwitch
              value={form.enabled}
              onValueChange={(v) => { patch({ enabled: v }); }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.primaryForeground}
              accessibilityLabel="Send away message"
            />
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Message</Text>
          <TextInput
            style={[styles.input, styles.messageInput, fieldStyle]}
            value={form.message}
            onChangeText={(v) => patch({ message: v.slice(0, MESSAGE_MAX) })}
            placeholder="Thanks for your message. We'll reply as soon as we're back."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
            testID="away-message-input"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Schedule</Text>
          <SegmentedControl
            options={[{ id: 'always', label: 'Always' }, { id: 'outside_hours', label: 'Outside hours' }]}
            selectedId={form.mode}
            onChange={(id) => { patch({ mode: id as SellerAwaySettings['mode'] }); }}
            testID="away-message-mode"
          />

          {form.mode === 'outside_hours' ? (
            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Open days</Text>
              <View style={styles.chips} testID="away-message-days">
                {DAY_LABELS.map((label, i) => {
                  const on = (form.openDays & (1 << i)) !== 0;
                  return (
                  <View key={label} style={styles.chipCell}>
                    <PressableScale
                      onPress={() => { haptics.selection(); patch({ openDays: form.openDays ^ (1 << i) }); }}
                      accessibilityRole="button"
                      accessibilityLabel={DAY_NAMES[i]}
                      accessibilityState={{ selected: on }}
                      style={[styles.dayBtn, { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.border }]}
                    >
                      <Text style={[styles.dayText, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text>
                    </PressableScale>
                  </View>
                  );
                })}
              </View>

              <View style={styles.hoursRow} testID="away-message-hours">
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Opens</Text>
                  <TextInput
                    style={[styles.input, fieldStyle]}
                    value={openText}
                    onChangeText={(v) => { setSaved(false); setOpenText(v); }}
                    placeholder="09:00"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    testID="away-message-open"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Closes</Text>
                  <TextInput
                    style={[styles.input, fieldStyle]}
                    value={closeText}
                    onChangeText={(v) => { setSaved(false); setCloseText(v); }}
                    placeholder="17:00"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numbers-and-punctuation"
                    testID="away-message-close"
                  />
                </View>
              </View>

              <Text style={[styles.label, { color: colors.mutedForeground }]}>Timezone</Text>
              <View style={[styles.input, styles.tzRow, fieldStyle]}>
                <Text style={[styles.tzText, { color: colors.foreground }]}>{form.timezone.replace(/_/g, ' ')}</Text>
              </View>
            </View>
          ) : null}

          {error ? <Text style={[styles.note, { color: colors.foreground }]}>{error}</Text> : null}
          {saved && !error ? <Text style={[styles.note, { color: colors.mutedForeground }]}>Saved</Text> : null}

          <View style={styles.actions}>
            <Button label="Save" onPress={save} loading={saving} disabled={saving} fullWidth testID="away-message-save" />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: SP.md, paddingBottom: 140 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: RADIUS.md, padding: 14, minHeight: 60 },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  label: { fontSize: FS.xs, fontFamily: FONT.semibold, marginTop: SP.md, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: FS.base, fontFamily: FONT.regular, minHeight: 48 },
  messageInput: { minHeight: 120 },
  chips: { flexDirection: 'row', gap: 6 },
  chipCell: { flex: 1 },
  dayBtn: { height: 40, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  hoursRow: { flexDirection: 'row', gap: 12 },
  tzRow: { justifyContent: 'center' },
  tzText: { fontSize: FS.base, fontFamily: FONT.regular },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: SP.md },
  actions: { marginTop: SP.lg },
});

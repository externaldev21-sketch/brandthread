/**
 * One-time permission before Brandthread AI sends someone's content to the AI
 * providers (App Store 5.1.2(i), QA-0043). Mounted once at the app root; it
 * registers itself with lib/aiConsent so the first AI request the server
 * refuses with `ai_consent_required` opens this sheet. "Allow" stores the
 * decision server-side and the request is retried; "Not now" sends nothing.
 * Settings > AI data sharing withdraws it.
 *
 * Layout follows Structured's AI privacy sheet (who receives it, what is
 * sent) in a Cash App-style bottom sheet, reskinned black / white.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { AI_PROVIDER_NAMES, setAiConsentPrompter } from '@/lib/aiConsent';
import { FONT, FS, SP } from '@/lib/theme';

const SENT: Array<{ icon: React.ComponentProps<typeof Feather>['name']; label: string }> = [
  { icon: 'image', label: 'Photos you upload, including any people in them' },
  { icon: 'message-square', label: 'Your prompts and messages to Brandthread AI' },
  { icon: 'shopping-bag', label: 'Product and store details you use in AI tools' },
];

export function providerList(names: readonly string[] = AI_PROVIDER_NAMES): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default function AiConsentSheet() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((allowed: boolean) => void) | null>(null);

  const settle = useCallback((allowed: boolean) => {
    resolver.current?.(allowed);
    resolver.current = null;
    setVisible(false);
  }, []);

  useEffect(() => setAiConsentPrompter(() => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setError(null);
    setVisible(true);
  })), []);

  async function allow() {
    setSaving(true);
    setError(null);
    try {
      await api.aiConsent.set(true);
      settle(true);
    } catch {
      setError('We couldn’t save your choice. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={() => settle(false)} testID="ai-consent-sheet">
      <View style={styles.body}>
        <View style={[styles.icon, { borderColor: colors.border }]}>
          <Feather name="cpu" size={22} color={colors.foreground} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Allow Brandthread AI?</Text>
        <Text style={[styles.lead, { color: colors.mutedForeground }]}>
          {`To create your result, Brandthread AI sends what you use in AI tools to our AI providers: ${providerList()}.`}
        </Text>
        <View style={[styles.list, { borderColor: colors.border }]}>
          {SENT.map((row) => (
            <View key={row.label} style={styles.row}>
              <Feather name={row.icon} size={16} color={colors.foreground} />
              <Text style={[styles.rowText, { color: colors.foreground }]}>{row.label}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          You can turn this off anytime in Settings, AI data sharing.
        </Text>
        <PressableScale
          onPress={() => { settle(false); router.push('/privacy' as never); }}
          accessibilityRole="link"
          style={styles.linkRow}
        >
          <Text style={[styles.link, { color: colors.foreground }]}>Privacy Policy</Text>
        </PressableScale>
        {error ? <Text style={[styles.note, { color: colors.destructive ?? colors.foreground }]}>{error}</Text> : null}
        <PrimaryButton label="Allow" onPress={allow} loading={saving} style={{ marginTop: SP.md }} />
        <PressableScale onPress={() => settle(false)} accessibilityRole="button" style={styles.secondary}>
          <Text style={[styles.secondaryText, { color: colors.foreground }]}>Not now</Text>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.sm },
  icon: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4 },
  lead: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, marginTop: SP.xs },
  list: { marginTop: SP.md, borderWidth: 1, borderRadius: 16, padding: SP.md, gap: SP.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  rowText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 19 },
  note: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: SP.md },
  linkRow: { alignSelf: 'flex-start', marginTop: SP.xs, minHeight: 28, justifyContent: 'center' },
  link: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  secondary: { alignItems: 'center', paddingVertical: SP.md },
  secondaryText: { fontFamily: FONT.semibold, fontSize: FS.base },
});

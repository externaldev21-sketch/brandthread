/**
 * Settings > AI data sharing (App Store 5.1.2(i), QA-0043): shows and changes
 * the server-stored permission for Brandthread AI to send content to its AI
 * providers. Turning it off stops every AI tool from sending anything; the
 * next AI action asks again.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { hapticToggle } from '@/lib/haptics';
import { ListRow } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { RetryRow } from '@/components/ui/RetryRow';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { AI_PROVIDER_NAMES } from '@/lib/aiConsent';
import { providerList } from '@/components/AiConsentSheet';

export default function AiDataSharingScreen() {
  const router = useRouter();
  const api = useApi();
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    // Signed-out preview never calls a protected API.
    if (!isSignedIn) { setGranted(false); return; }
    setFailed(false);
    api.aiConsent.get().then((r) => setGranted(r.granted)).catch(() => setFailed(true));
  }, [api, isSignedIn]);

  useEffect(() => { load(); }, [load]);

  async function toggle(value: boolean) {
    hapticToggle();
    const prior = granted;
    setGranted(value);
    try {
      const r = await api.aiConsent.set(value);
      setGranted(r.granted);
    } catch {
      setGranted(prior);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="AI data sharing" onBack={() => goBackOr(router, '/settings' as never)} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          {granted === null ? (
            failed
              ? <RetryRow label="Couldn't load this setting" onRetry={load} />
              : <ActivityIndicator color={colors.foreground} />
          ) : (
            <Card>
              <ListRow
                icon="cpu"
                title="Allow Brandthread AI"
                subtitle={`Send what you use in AI tools to ${providerList(AI_PROVIDER_NAMES)}`}
                subtitleNumberOfLines={2}
                toggle={{ value: granted, onChange: toggle }}
                disabled={!isSignedIn}
              />
            </Card>
          )}
        </View>
        <View style={styles.section}>
          <Text style={[TYPE_SCALE.footnote, styles.note, { color: colors.mutedForeground }]}>
            This covers the photos you upload (including any people in them), your prompts and messages to Brandthread AI, and the product and store details you use in AI tools. With this off, AI tools send nothing and ask again before the next use.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  section: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  note: { lineHeight: 17 },
});

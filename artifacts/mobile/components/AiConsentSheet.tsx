/**
 * One-time AI data-sharing consent sheet (App Store Review Guideline 5.1.2(i)).
 *
 * Reference: Runna "Activate Workout Insights" (names OpenAI, says what is
 * shared and why, links the privacy policy, Accept / Decline)
 * https://mobbin.com/screens/5876fe0a-be7c-45ac-9760-a59e7a6af7ba
 * and Apple's own "Use ChatGPT?" prompt. Reskinned as a solid #1C1C1E bottom
 * sheet (no translucency), one primary button + a plain text button.
 *
 * Usage:
 *   const aiConsent = useAiConsentGate({ local: isPreview });
 *   if (!(await aiConsent.ensure())) return;   // before sending to the agent
 *   ...
 *   {aiConsent.sheet}
 */
import React, { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import {
  AI_CONSENT_COPY as COPY,
  cacheAiConsent,
  hasCachedAiConsent,
} from '@/lib/aiConsent';

const SHEET_BG = '#1C1C1E';
const SILVER = '#C0C0C0';

interface Options {
  /** Preview / demo conversation: no backend, keep the answer in memory only. */
  local?: boolean;
}

export function useAiConsentGate({ local = false }: Options = {}) {
  const api = useApi();
  const { userId } = useAuth();
  const accountKey = local ? 'local-preview' : userId ?? 'signed-out';
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    setVisible(false);
    setSaving(false);
    setError(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(ok);
  }, []);

  const ensure = useCallback(async (): Promise<boolean> => {
    if (hasCachedAiConsent(accountKey)) return true;
    if (!local) {
      try {
        const status = await api.aiConsent.get();
        if (status.consented) {
          cacheAiConsent(accountKey);
          return true;
        }
      } catch {
        // Unknown state: ask (fail closed) rather than send.
      }
    }
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setError(null);
      setVisible(true);
    });
  }, [accountKey, api, local]);

  const allow = useCallback(async () => {
    if (saving) return;
    if (local) {
      cacheAiConsent(accountKey);
      settle(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api.aiConsent.accept();
      if (!res.consented) throw new Error('not saved');
      cacheAiConsent(accountKey);
      settle(true);
    } catch {
      setSaving(false);
      setError(COPY.error);
    }
  }, [accountKey, api, local, saving, settle]);

  const sheet = (
    <AiConsentSheet
      visible={visible}
      saving={saving}
      error={error}
      onAllow={allow}
      onNotNow={() => settle(false)}
    />
  );

  return { ensure, sheet };
}

interface SheetProps {
  visible: boolean;
  saving?: boolean;
  error?: string | null;
  onAllow: () => void;
  onNotNow: () => void;
}

export function AiConsentSheet({ visible, saving, error, onAllow, onNotNow }: SheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onNotNow} statusBarTranslucent>
      <View style={s.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onNotNow} accessibilityLabel={COPY.notNow} />
        <View
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, SP.md) + SP.sm }]}
          accessibilityViewIsModal
          testID="ai-consent-sheet"
        >
          <View style={s.handle} />
          <Text style={s.title} accessibilityRole="header">{COPY.title}</Text>
          <Text style={s.lead}>{COPY.lead}</Text>
          <Text style={s.detail}>{COPY.detail}</Text>
          <Pressable
            onPress={() => { onNotNow(); router.push('/privacy' as never); }}
            accessibilityRole="link"
            hitSlop={8}
            style={s.linkWrap}
          >
            <Text style={s.link}>{COPY.privacyLink}</Text>
          </Pressable>
          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <PrimaryButton label={COPY.allow} onPress={onAllow} loading={saving} disabled={saving} testID="ai-consent-allow" />
          <Pressable onPress={onNotNow} style={s.secondary} accessibilityRole="button" testID="ai-consent-not-now">
            <Text style={s.secondaryText}>{COPY.notNow}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.lg,
    paddingTop: SP.sm,
    gap: SP.md,
  },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: '#48484A', marginBottom: SP.xs },
  title: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 22, lineHeight: 28 },
  lead: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.md, lineHeight: 22 },
  detail: { color: SILVER, fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 21 },
  linkWrap: { alignSelf: 'flex-start' },
  link: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.base, textDecorationLine: 'underline' },
  error: { color: '#FF453A', fontFamily: FONT.regular, fontSize: FS.sm },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.base },
});

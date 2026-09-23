/**
 * Makes sure every signed-in account has agreed to the current Terms of
 * Service, Community Guidelines and Privacy Policy (content/legal.ts).
 *
 * - Just signed up with the agreement box checked → records it silently.
 * - Existing account, OAuth sign-up from the sign-in screen, or documents
 *   updated since the last agreement → asks the person to review and agree.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { LegalConsent } from '@/components/legal/LegalConsent';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { EFFECTIVE_DATE, LEGAL_DOCUMENTS, LEGAL_DOCUMENT_ORDER, LEGAL_VERSION } from '@/content/legal';
import { apiErrorCode, apiErrorMessage } from '@/lib/safety';
import { clearPendingConsent, hasAcceptedCurrentTerms, readPendingConsent } from '@/lib/legalConsent';

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

export default function LegalAcceptanceGate() {
  const { isSignedIn, userId, signOut } = useAuth();
  const api = useApi();
  const router = useRouter();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [needsAgreement, setNeedsAgreement] = useState(false);
  const [previouslyAgreed, setPreviouslyAgreed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  const check = useCallback(async (): Promise<'done' | 'retry'> => {
    try {
      const profile = await api.auth.me();
      if (hasAcceptedCurrentTerms(profile.termsVersion)) {
        setNeedsAgreement(false);
        return 'done';
      }
      const pending = await readPendingConsent();
      if (pending && hasAcceptedCurrentTerms(pending.version)) {
        await api.auth.acceptLegal(pending.version);
        await clearPendingConsent();
        setNeedsAgreement(false);
        return 'done';
      }
      setPreviouslyAgreed(!!profile.termsVersion);
      setNeedsAgreement(true);
      return 'done';
    } catch (err) {
      // The local account may not exist yet while onboarding is syncing.
      return apiErrorCode(err) === 'NOT_FOUND' || !apiErrorCode(err) ? 'retry' : 'done';
    }
  }, [api]);

  useEffect(() => {
    setNeedsAgreement(false);
    setChecked(false);
    attemptRef.current = 0;
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const outcome = await check();
      if (cancelled || outcome === 'done') return;
      const delay = RETRY_DELAYS_MS[attemptRef.current];
      attemptRef.current += 1;
      if (delay) timer = setTimeout(run, delay);
    };
    run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [check, isSignedIn, userId]);

  async function agree() {
    if (!checked) { setShowError(true); return; }
    setSaving(true);
    setError(null);
    try {
      await api.auth.acceptLegal(LEGAL_VERSION);
      await clearPendingConsent();
      setNeedsAgreement(false);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t save your agreement. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  if (!isSignedIn || !needsAgreement) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top + SP.lg, paddingBottom: insets.bottom + SP.md }]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg }} showsVerticalScrollIndicator={false}>
          <View style={[styles.icon, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Feather name="file-text" size={22} color={theme.text} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>
            {previouslyAgreed ? 'We’ve updated our terms' : 'Before you continue'}
          </Text>
          <Text style={[styles.body, { color: theme.muted }]}>
            {previouslyAgreed
              ? `Please review the updated documents (effective ${EFFECTIVE_DATE}) and agree to keep using Brandthread.`
              : 'Brandthread is a community of buyers, sellers and makers. Please review and agree to how it works — including our zero-tolerance rules for abusive or objectionable content.'}
          </Text>

          <View style={[styles.docs, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {LEGAL_DOCUMENT_ORDER.map((id, index) => {
              const doc = LEGAL_DOCUMENTS[id];
              return (
                <PressableScale
                  key={id}
                  onPress={() => router.push(doc.route as never)}
                  style={[styles.docRow, index > 0 && { borderTopWidth: 1, borderTopColor: theme.borderSubtle }]}
                  accessibilityRole="link"
                >
                  <Text style={[styles.docTitle, { color: theme.text }]}>{doc.title}</Text>
                  <Feather name="chevron-right" size={16} color={theme.subtle} />
                </PressableScale>
              );
            })}
          </View>

          <LegalConsent checked={checked} onChange={(value) => { setChecked(value); setShowError(false); }} showError={showError} style={{ marginTop: SP.lg }} />
          {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
        </ScrollView>
        <View style={{ paddingHorizontal: SP.lg, gap: SP.xs }}>
          <PrimaryButton label="Agree and continue" onPress={agree} loading={saving} disabled={!checked} />
          <PressableScale onPress={() => { signOut().catch(() => {}); }} style={styles.signOut} accessibilityRole="button">
            <Text style={[styles.signOutText, { color: theme.muted }]}>Sign out</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  icon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg },
  title: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6 },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 23, marginTop: SP.sm },
  docs: { marginTop: SP.lg, borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, minHeight: 54 },
  docTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.md },
  signOut: { alignItems: 'center', paddingVertical: SP.md },
  signOutText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

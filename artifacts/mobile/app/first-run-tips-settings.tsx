/**
 * Settings > Tips — the real controls for the first-run tips system:
 *  - "Skip all tips": suppresses every future first-run tip for this account
 *    (server-side, migration 110's first_run_tips_settings). Toggling it off
 *    clears skipAll on the server and locally; seen tips stay seen.
 *  - "Replay tips": a genuine reset — clears seen-state locally AND on the
 *    server, and turns "Skip all tips" back off, so every first-run tip
 *    shows again from a fresh state next time its screen is opened.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRouter } from 'expo-router';

import { useColors } from '@/hooks/useColors';

import { ScreenHeader } from '@/components/ScreenHeader';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';

import { ConfirmSheet } from '@/components/settings/SettingsKit';

import { haptics, haptic } from '@/lib/haptics';


import { FONT, FS, SP, RADIUS } from '@/lib/theme';

import { useFirstRunTipsController } from '@/contexts/FirstRunTipsContext';

export default function FirstRunTipsSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const controller = useFirstRunTipsController();
  const [replayVisible, setReplayVisible] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayedAt, setReplayedAt] = useState<number | null>(null);
  const [savingSkipAll, setSavingSkipAll] = useState(false);
  const [error, setError] = useState('');

  async function toggleSkipAll(value: boolean) {
    if (savingSkipAll) return;
    haptic('select');
    setError('');
    setSavingSkipAll(true);
    try {
      await controller.setSkipAll(value);
    } catch (e) {
      setError(tipsErrorMessage(e, value ? "Couldn't turn on Skip all tips." : "Couldn't turn off Skip all tips."));
    } finally {
      setSavingSkipAll(false);
    }
  }

  async function confirmReplay() {
    setReplaying(true);
    setError('');
    try {
      await controller.replayTips();
      setReplayedAt(Date.now());
    } catch (e) {
      setError(tipsErrorMessage(e, "Couldn't replay tips."));
    } finally {
      setReplaying(false);
      setReplayVisible(false);
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Tips" onBack={() => goBackOr(router, '/general-settings')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Skip all tips</Text>
            </View>
            <HapticSwitch
              testID="first-run-tips-skip-all"
              value={controller.skipAll}
              disabled={savingSkipAll}
              onValueChange={toggleSkipAll}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={controller.skipAll ? colors.primaryForeground : colors.foreground}
              accessibilityLabel="Skip all tips"
            />
          </View>

          {error ? (
            <Text testID="first-run-tips-error" style={[styles.error, { color: colors.destructive }]}>{error}</Text>
          ) : null}

          <PressableScale
            onPress={() => { haptic('sheet'); setReplayVisible(true); }}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, marginTop: SP.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Replay tips"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Replay tips</Text>
              {replayedAt ? (
                <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                  Reset — tips will show again as you open each screen
                </Text>
              ) : null}
            </View>
          </PressableScale>
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={replayVisible}
        title="Replay all tips?"
        message="First-run tips will show again the next time you open each screen, as if this were a brand-new account."
        confirmLabel="Replay tips"
        destructive={false}
        loading={replaying}
        onConfirm={confirmReplay}
        onCancel={() => setReplayVisible(false)}
      />
    </View>
  );
}

function tipsErrorMessage(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message.trim() : '';
  return message ? `${fallback} ${message}` : `${fallback} Check your connection and try again.`;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  error: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: SP.sm, lineHeight: 16 },
  section: { paddingHorizontal: 20, paddingTop: 18 },
  sectionSubtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: 18, lineHeight: 18 },
  // padding: 16 (not SP.md's 14) — the audit's text-fit check flags
  // anything under 16px inner padding on a card-sized container; see
  // docs/audit/README.md.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 1, padding: 16, minHeight: 60 },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2, lineHeight: 15 },
});

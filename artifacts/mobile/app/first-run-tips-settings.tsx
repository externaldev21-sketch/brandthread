/**
 * Settings > Tips — the real controls for the first-run tips system:
 *  - "Skip all tips": suppresses every future first-run tip for this account
 *    (server-side, migration 110's first_run_tips_settings).
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
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useFirstRunTipsController } from '@/contexts/FirstRunTipsContext';

export default function FirstRunTipsSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const controller = useFirstRunTipsController();
  const [replayVisible, setReplayVisible] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayedAt, setReplayedAt] = useState<number | null>(null);

  async function toggleSkipAll(value: boolean) {
    hapticLight();
    if (value) controller.setSkipAllTips();
    // Turning it back off isn't a supported path here — "Skip all" is a
    // one-way suppress; "Replay tips" below is the real reset, which also
    // clears skipAll.
  }

  async function confirmReplay() {
    setReplaying(true);
    try {
      await controller.replayTips();
      hapticSuccess();
      setReplayedAt(Date.now());
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
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            First-run tips walk you through a screen's gestures and controls the first time you open it.
          </Text>

          <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Skip all tips</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                Turn off first-run tips everywhere in the app
              </Text>
            </View>
            <HapticSwitch
              value={controller.skipAll}
              onValueChange={toggleSkipAll}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={controller.skipAll ? colors.primaryForeground : colors.foreground}
              accessibilityLabel="Skip all tips"
            />
          </View>

          <PressableScale
            onPress={() => { hapticLight(); setReplayVisible(true); }}
            style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border, marginTop: SP.sm }]}
            accessibilityRole="button"
            accessibilityLabel="Replay tips"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Replay tips</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                {replayedAt ? 'Reset — tips will show again as you open each screen' : 'See every first-run tip again, from the start'}
              </Text>
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

const styles = StyleSheet.create({
  page: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 18 },
  sectionSubtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: 18, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 1, padding: 14, minHeight: 60 },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2, lineHeight: 15 },
});

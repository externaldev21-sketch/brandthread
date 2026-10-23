/**
 * Settings > Tips — the real controls for the first-run tips system:
 *  - "Skip all tips": suppresses every future first-run tip for this account
 *    (server-side, migration 110's first_run_tips_settings).
 *  - "Replay tips": a genuine reset — clears seen-state locally AND on the
 *    server, and turns "Skip all tips" back off, so every first-run tip
 *    shows again from a fresh state next time its screen is opened.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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
    } catch {
      Alert.alert('Couldn’t reset tips', 'Check your connection and try again.');
    } finally {
      setReplaying(false);
      setReplayVisible(false);
    }
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Tips" onBack={() => goBackOr(router, '/general-settings')} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SP.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            First-run tips walk you through a screen's gestures and controls the first time you open it.
          </Text>

          <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>Skip all tips</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                {controller.skipAll ? 'Tips are off. Use Replay tips to turn them back on.' : 'Turn off first-run tips everywhere in the app'}
              </Text>
            </View>
            <HapticSwitch
              value={controller.skipAll}
              onValueChange={toggleSkipAll}
              disabled={controller.skipAll}
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
  section: { paddingHorizontal: SP.md, paddingTop: SP.md },
  sectionSubtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginBottom: SP.md, lineHeight: 18 },
  // 16px inner padding — the audit's text-fit check flags anything less on
  // a card-sized container; see docs/audit/README.md.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 1, padding: SP.md, minHeight: 60 },
  rowTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  rowSub: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2, lineHeight: 16 },
});

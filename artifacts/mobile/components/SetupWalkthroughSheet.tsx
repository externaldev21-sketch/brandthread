/**
 * SetupWalkthroughSheet — guided, step-by-step store setup walkthrough.
 *
 * Shown automatically to a seller whose account is incomplete, and
 * reachable any time via the "Continue setup" dashboard banner. Built
 * entirely on top of the existing lib/setupStore.ts checklist (from the
 * merged onboarding PR) — no duplicate task list or completion logic.
 */
import React, { useCallback, useMemo } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';
import {
  SetupState, SetupTask, SetupTaskId,
  completionPercent, nextTask, completedRequiredTaskCount, requiredTaskCount,
  markSetupStarted, dismissWelcome, skipTask,
} from '@/lib/setupStore';
import SetupProgressRing from '@/components/SetupProgressRing';

export default function SetupWalkthroughSheet({
  visible,
  onClose,
  userId,
  setupState,
  onSetupStateChange,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | null | undefined;
  setupState: SetupState;
  onSetupStateChange: (next: SetupState) => void;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(theme), [theme]);

  const pct = completionPercent(setupState);
  const active = nextTask(setupState);
  const done = completedRequiredTaskCount(setupState);
  const total = requiredTaskCount(setupState);

  const handleClose = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = await dismissWelcome(userId);
    onSetupStateChange(next);
    onClose();
  }, [onClose, onSetupStateChange, userId]);

  const openTask = useCallback(async (task: SetupTask) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const next = await markSetupStarted(userId);
    onSetupStateChange(next);
    onClose();
    try {
      router.push(withSellerSetupOrigin(task.route) as never);
    } catch { /* ignore */ }
  }, [onClose, onSetupStateChange, router, userId]);

  const handleSkip = useCallback((task: SetupTask) => {
    Alert.alert(
      `Skip "${task.label}"?`,
      'You can always come back to this later from the setup checklist.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: async () => {
            const next = await skipTask(task.id as SetupTaskId, userId);
            onSetupStateChange(next);
          },
        },
      ],
    );
  }, [onSetupStateChange, userId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + SP.lg }]}>
          <View style={s.grabber} />

          <View style={s.header}>
            <SetupProgressRing
              percent={pct}
              trackColor={theme.border}
              fillColor={theme.accent}
              textColor={theme.text}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Let's set up your store</Text>
              <Text style={s.subtitle}>
                {done} of {total} steps complete
                {active ? ` · Next: ${active.label}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close setup walkthrough"
            >
              <Feather name="x" size={ICON.md} color={theme.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: SP.sm }}
          >
            {setupState.tasks.map((task) => {
              const isActive = active?.id === task.id;
              const isSkipped = task.skipped && !task.completed;
              return (
                <TouchableOpacity
                  key={task.id}
                  activeOpacity={0.85}
                  onPress={() => openTask(task)}
                  style={[
                    s.row,
                    task.completed && s.rowDone,
                    isActive && s.rowActive,
                  ]}
                >
                  <View style={[
                    s.iconWrap,
                    task.completed && { backgroundColor: theme.success },
                    isActive && !task.completed && { backgroundColor: theme.accent },
                  ]}>
                    <Feather
                      name={task.completed ? 'check' : (task.icon as keyof typeof Feather.glyphMap)}
                      size={ICON.sm}
                      color={task.completed || isActive ? theme.onAccent : theme.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowLabel, (task.completed || isSkipped) && s.rowLabelMuted]} numberOfLines={1}>
                      {task.label}{task.optional ? ' (optional)' : ''}
                    </Text>
                    <Text style={s.rowDesc} numberOfLines={1}>
                      {isSkipped ? 'Skipped' : task.description}
                    </Text>
                  </View>
                  {!task.completed && (
                    <TouchableOpacity
                      onPress={() => handleSkip(task)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={s.skip}>Skip</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={s.primaryBtn} onPress={() => (active ? openTask(active) : handleClose())}>
            <Text style={s.primaryBtnText}>
              {active ? `Continue: ${active.label}` : 'Done'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={handleClose}>
            <Text style={s.secondaryBtnText}>Continue setup later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: theme.border, borderBottomWidth: 0,
    paddingHorizontal: SP.lg, paddingTop: SP.sm, maxHeight: '86%',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, marginBottom: SP.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.lg },
  title: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.3 },
  subtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.sm, paddingHorizontal: SP.sm, borderRadius: RADIUS.md,
    marginBottom: SP.xs, borderWidth: 1, borderColor: 'transparent',
  },
  rowActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  rowDone: { opacity: 0.55 },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border,
  },
  rowLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  rowLabelMuted: { textDecorationLine: 'line-through', color: theme.muted },
  rowDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 1 },
  skip: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle },
  primaryBtn: {
    marginTop: SP.md, height: 50, borderRadius: RADIUS.pill, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
  secondaryBtn: { marginTop: SP.sm, height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
});

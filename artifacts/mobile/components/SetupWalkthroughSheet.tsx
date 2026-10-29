/**
 * SetupWalkthroughSheet — guided, step-by-step store setup walkthrough.
 *
 * Shown automatically to a seller whose account is incomplete, and
 * reachable any time via the "Continue setup" dashboard banner. The steps,
 * done flags and count are the server launch checklist (the same source as
 * every other setup prompt); lib/setupStore.ts only keeps the sheet's own
 * started / dismissed flags.
 */
import React, { useCallback, useMemo } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable, useWindowDimensions } from 'react-native';

import Animated from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';

import { useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

import { withOrigin } from '@/lib/navigation/flowOrigin';

import { useSheetTransition } from '@/components/ui/BottomSheet';

import { SetupState, markSetupStarted, dismissWelcome } from '@/lib/setupStore';
import { LAUNCH_STEP_META, launchProgress, type LaunchChecklistResponse, type LaunchStepId } from '@/lib/launchChecklist';

import SetupProgressRing from '@/components/SetupProgressRing';
import { radius } from '@/constants/radii';
import { useDesktopShell } from '@/components/web/DesktopShellContext';

/** Desktop web shell: the sheet keeps a phone-sheet width, centered, instead
 *  of spanning the whole browser window. */
const DESKTOP_SHEET_MAX_WIDTH = 640;

export default function SetupWalkthroughSheet({
  visible,
  onClose,
  userId,
  checklist,
  onSetupStateChange,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | null | undefined;
  checklist: LaunchChecklistResponse | null;
  onSetupStateChange: (next: SetupState) => void;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => createStyles(theme), [theme]);

  // Backdrop opacity and sheet translateY animate on their own timeline
  // (reanimated, UI thread) instead of both riding RN `Modal`'s single
  // `animationType="slide"` transform: that transform slides the WHOLE
  // modal subtree — backdrop included — as one block, so mid-close a
  // shrinking sliver of the still-partially-onscreen, still-opaque backdrop
  // sweeps across the very bottom of the viewport and paints straight over
  // the floating tab bar (a separate, always-on-top layer the sliding
  // Modal portal has no relationship to) for a frame or two — the "thin
  // dark bar flashing over the tab bar" bug. `useSheetTransition` is the
  // same shared engine `components/ui/BottomSheet.tsx` uses: the backdrop
  // only ever fades in place, never moves, so nothing but the sheet card
  // itself is ever in transit.
  const { modalVisible, sheetStyle, backdropStyle } = useSheetTransition(visible, onClose);

  const progress = checklist ? launchProgress(checklist) : null;
  const pct = progress?.percent ?? 0;
  const active = progress?.next ?? null;

  const handleClose = useCallback(async () => {
    haptic('sheet');
    const next = await dismissWelcome(userId);
    onSetupStateChange(next);
    onClose();
  }, [onClose, onSetupStateChange, userId]);

  const openStep = useCallback(async (id: LaunchStepId) => {
    const next = await markSetupStarted(userId);
    onSetupStateChange(next);
    onClose();
    try {
      router.push(withOrigin(LAUNCH_STEP_META[id].route, 'dashboard') as never);
    } catch { /* ignore */ }
  }, [onClose, onSetupStateChange, router, userId]);

  const desktopShell = useDesktopShell();
  const { width: windowWidth } = useWindowDimensions();
  const desktopInset = desktopShell ? Math.max(0, (windowWidth - DESKTOP_SHEET_MAX_WIDTH) / 2) : null;

  return (
    <Modal visible={modalVisible} animationType="none" transparent onRequestClose={handleClose}>
      <View style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
          >
            <View style={[StyleSheet.absoluteFill, s.backdropFill]} />
          </Pressable>
        </Animated.View>
        <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + SP.lg }, desktopInset !== null && { left: desktopInset, right: desktopInset }, sheetStyle]}>
          <View style={s.grabber} />

          <View style={s.header}>
            <SetupProgressRing
              percent={pct}
              trackColor={theme.border}
              fillColor={theme.accent}
              textColor={theme.text}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Set up your store</Text>
              {progress && (
                <Text style={s.subtitle}>
                  {progress.done} of {progress.total} steps complete
                  {active ? ` · Next: ${LAUNCH_STEP_META[active].title}` : ''}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close setup walkthrough"
            >
              <Icon name="x" size={ICON.md} color={theme.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.list}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: SP.sm }}
          >
            {(checklist?.steps ?? []).map((step) => {
              const meta = LAUNCH_STEP_META[step.id];
              const isActive = active === step.id;
              return (
                <TouchableOpacity
                  key={step.id}
                  activeOpacity={0.85}
                  onPress={() => openStep(step.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${meta.title}${step.done ? ', done' : ''}`}
                  style={[
                    s.row,
                    step.done && s.rowDone,
                    isActive && s.rowActive,
                  ]}
                >
                  <View style={[
                    s.iconWrap,
                    // Monochrome only: a completed step is told apart by the
                    // solid accent fill + checkmark glyph, never a green tint
                    // (this screen has none of the app's 3 allowed color
                    // accents — LIVE-red, end-call-red, Thread Cash green).
                    (step.done || isActive) && { backgroundColor: theme.accent },
                  ]}>
                    <Icon
                      name={step.done ? 'check' : meta.icon}
                      size={ICON.sm}
                      color={step.done || isActive ? theme.onAccent : theme.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowLabel, step.done && s.rowLabelMuted]} numberOfLines={1}>
                      {meta.title}
                    </Text>
                    <Text style={s.rowDesc} numberOfLines={1}>
                      {meta.body}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={s.primaryBtn} onPress={() => (active ? openStep(active) : handleClose())}>
            <Text style={s.primaryBtnText}>
              {active ? `Continue: ${LAUNCH_STEP_META[active].title}` : 'Done'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={handleClose}>
            <Text style={s.secondaryBtnText}>Continue setup later</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { backgroundColor: 'rgba(0,0,0,0.6)' }, // theme-exempt: neutral backdrop behind setup walkthrough
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
  primaryBtn: {
    marginTop: SP.md, height: 50, borderRadius: radius.md, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
  secondaryBtn: { marginTop: SP.sm, height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
});

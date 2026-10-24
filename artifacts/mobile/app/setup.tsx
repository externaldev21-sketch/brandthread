/**
 * Brandthread Guided Setup Screen
 *
 * The launch checklist (GET /api/seller/launch-checklist) is the counted list
 * and the one progress number — the same count the dashboard, More and Launch
 * your store show. A few extra guided tasks from setupStore (domain, first
 * post, manufacturer) follow under it, uncounted, with Skip; the one with no
 * server signal is ticked by hand with a long-press or its circle.
 */

import React, { useState, useCallback, useRef } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Animated, ActivityIndicator } from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from '@/components/ui/Icon';

import { useFocusEffect, useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';

import { useAuth } from '@clerk/expo';

import { BG, CARD, BORDER, FG, MUTED, SUBTLE, ON_DARK, FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';

import { useColors } from '@/hooks/useColors';

import { withOrigin } from '@/lib/navigation/flowOrigin';
import {
  getSetupState, completeTask, skipTask,
  SetupState, SetupTaskId, isAutoTrackedTask,
} from '@/lib/setupStore';
import { useApi } from '@/hooks/useApi';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { LAUNCH_STEP_META, launchProgress } from '@/lib/launchChecklist';
import { confirmAlert, showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';

/** Guided tasks the launch checklist doesn't already cover. */
const EXTRA_TASK_IDS: readonly SetupTaskId[] = ['connect_domain', 'first_post', 'connect_manufacturer'];
const SAVE_FAILED = 'Could not save your progress. Check your connection and try again.';

import { isPreviewDemoMode, isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';

import { PREVIEW_DEMO_SETUP_TASKS, previewSetupUserId } from '@/lib/previewAccount';

import { GradientCard, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/BrandthreadUI';

import { ScreenHeader } from '@/components/ScreenHeader';

import { ThreadProgress } from '@/components/onboarding/ThreadLine';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';


import { crispPx } from '@/lib/crispPixel';

// ─── Task Step Card ───────────────────────────────────────────────────────────

/** One row: a launch checklist step, or one of the extra guided tasks. */
interface SetupRow {
  id: string;
  label: string;
  description: string;
  route: string;
  completed: boolean;
  /** No server signal — the seller can tick it by hand (long-press or the circle). */
  manual: boolean;
  /** Extra tasks can be skipped; launch steps can't. */
  skippable: boolean;
}

function TaskCard({
  task, active, onComplete, onSkip, onPress,
}: {
  task: SetupRow;
  active: boolean;
  onComplete: (task: SetupRow) => void;
  onSkip: (task: SetupRow) => void;
  onPress: (task: SetupRow) => void;
}) {
  const colors = useColors();
  const ts = createTaskStyles(colors);
  const scale = useRef(new Animated.Value(1)).current;

  function handleComplete() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start(() => onComplete(task));
  }

  async function handleLongPress() {
    if (task.completed || !task.manual) return;
    const ok = await confirmAlert({ title: task.label, message: task.description, confirmLabel: 'Mark complete' });
    if (ok) handleComplete();
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        activeOpacity={0.85}
        // A tap always opens the task's screen; manual tasks are ticked with a
        // long-press or the circle.
        onPress={() => onPress(task)}
        onLongPress={task.manual && !task.completed ? () => { void handleLongPress(); } : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${task.label}${task.completed ? ', done' : ''}`}
        accessibilityHint={task.manual && !task.completed ? 'Long-press to mark complete' : undefined}
        style={[
          ts.card,
          active && !task.completed && ts.cardActive,
        ]}
      >
        {/* Left: check circle */}
        <TouchableOpacity
          // Auto-tracked tasks complete only when the real work is done — the
          // circle opens the task instead of ticking it.
          onPress={task.completed ? undefined : task.manual ? handleComplete : () => onPress(task)}
          style={[ts.check, task.completed && ts.checkDone]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed, disabled: task.completed }}
          accessibilityLabel={task.completed ? `${task.label} done` : task.manual ? `Mark ${task.label} complete` : `Open ${task.label}`}
        >
          {task.completed && <Icon name="check" size={ICON.sm} color={colors.primaryForeground} />}
        </TouchableOpacity>

        {/* Center: content */}
        <View style={ts.body}>
          <View style={ts.labelRow}>
            <Text style={[ts.label, task.completed && ts.labelDone]}>{task.label}</Text>
            {active && !task.completed && (
              <View style={ts.activePill}>
                <Text style={ts.activePillText}>Now</Text>
              </View>
            )}
          </View>
          <Text style={ts.desc} numberOfLines={2}>{task.description}</Text>
        </View>

        {/* Right: action */}
        {task.skippable && !task.completed && (
          <TouchableOpacity
            onPress={() => onSkip(task)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${task.label}`}
          >
            <Text style={ts.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const createTaskStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: colors.card,
                borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
                paddingHorizontal: SP.md, paddingVertical: 16, marginBottom: SP.sm },
  cardActive: { borderColor: colors.primary, backgroundColor: colors.accent },
  check:      { width: 26, height: 26, borderRadius: 13, borderWidth: crispPx(1.5), borderColor: colors.primary,
                alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkDone:  { backgroundColor: colors.primary, borderColor: colors.primary },
  body:       { flex: 1 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 2 },
  label:      { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  labelDone:  { textDecorationLine: 'line-through', color: MUTED },
  desc:       { fontSize: FS.meta, lineHeight: 16, fontFamily: FONT.regular, color: MUTED },
  activePill: { backgroundColor: colors.primary, borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 2 },
  activePillText: { fontSize: FS.xs, fontFamily: FONT.bold, color: colors.primaryForeground },
  skip:       { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SetupScreen() {
  const colors = useColors();
  const s = createStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId: authUserId } = useAuth();
  // The signed-out preview has no Clerk user: keep its checklist under the
  // preview seller's own key (separate for demo), so it reflects that account.
  const [previewDemo] = useState(() => !authUserId && isSellerDevPreview() ? isPreviewDemoMode() : null);
  const userId = previewDemo === null ? authUserId : previewSetupUserId(previewDemo);
  const api = useApi();
  const { theme } = useAppTheme();
  const [state, setState] = useState<SetupState | null>(null);
  const tabBarInset = useSellerTabBarInset();
  const { checklist, error: checklistError, reload: reloadChecklist } = useLaunchChecklist();

  useFocusEffect(useCallback(() => {
    let active = true;
    const load = async () => {
      // This remains a focus refresh (the legacy contract was
      // getSetupState().then(next => {); the authenticated key is selected
      // before the read now.
      let onboardingComplete = false;
      try {
        // Signed-out preview has no session for the protected profile call.
        if (isSellerDevPreview() || isBuyerDevPreview()) throw new Error('preview');
        const profile = await api.auth.me();
        onboardingComplete = profile.accountType === 'seller' && profile.onboardingComplete === true;
      } catch {
        // Preserve local progress when the profile endpoint is temporarily
        // unavailable; only the server response can complete verification.
      }
      let next = await getSetupState(userId, { onboardingComplete });
      if (previewDemo) {
        for (const id of PREVIEW_DEMO_SETUP_TASKS) {
          if (!next.tasks.find((task) => task.id === id)?.completed) next = await completeTask(id, userId);
        }
      }
      if (!active) return;
      setState(next);
    };
    void load();
    return () => { active = false; };
  }, [api, previewDemo, userId]));

  async function handleComplete(task: SetupRow) {
    const id = task.id as SetupTaskId;
    if (!task.manual || isAutoTrackedTask(id)) return; // derived on the server; never ticked by hand
    try {
      const next = await completeTask(id, userId, { throwOnSyncError: true });
      setState(next);
    } catch (err) {
      showAlert('Not saved', friendlyError(err, SAVE_FAILED));
    }
  }

  async function handleSkip(task: SetupRow) {
    try {
      const next = await skipTask(task.id as SetupTaskId, userId, { throwOnSyncError: true });
      setState(next);
    } catch (err) {
      showAlert('Not saved', friendlyError(err, SAVE_FAILED));
    }
  }

  function openTask(task: SetupRow) {
    // push (never replace) with an explicit origin so the task's Cancel/Back
    // pops to this checklist, not to a tabs index (docs/NAVIGATION.md).
    try { router.push(withOrigin(task.route, 'setup') as never); } catch { /* ok */ }
  }

  const progress = checklist ? launchProgress(checklist) : null;
  const launchRows: SetupRow[] = (checklist?.steps ?? []).map((step) => ({
    id: step.id,
    label: LAUNCH_STEP_META[step.id].title,
    description: LAUNCH_STEP_META[step.id].body,
    route: LAUNCH_STEP_META[step.id].route,
    completed: step.done,
    manual: false,
    skippable: false,
  }));
  const extraRows: SetupRow[] = (state?.tasks ?? [])
    .filter((task) => EXTRA_TASK_IDS.includes(task.id) && !task.skipped)
    .map((task) => ({
      id: task.id,
      label: task.optional ? `${task.label} (optional)` : task.label,
      description: task.description,
      route: task.route,
      completed: task.completed,
      manual: !isAutoTrackedTask(task.id),
      skippable: true,
    }));
  const pct = progress?.percent ?? 0;
  const next = progress?.next ? launchRows.find((row) => row.id === progress.next) ?? null : null;
  const allDone = progress?.complete ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScreenHeader
        title="Store setup"
        variant="modal"
        onBack={() => goBackOr(router)}
        rightElement={
          progress ? (
            <View style={s.pctBadge}>
              <Text style={s.pctText}>{progress.label}</Text>
            </View>
          ) : undefined
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: insets.bottom + 80 + tabBarInset }}
      >
        {/* Progress bar */}
        <GradientCard colors={[colors.accent, colors.card]} style={s.progressCard} glow>
          <ThreadProgress
            fraction={pct / 100}
            color={theme.text}
            trackColor={theme.border}
            accessibilityLabel={progress ? `Store setup, ${progress.done} of ${progress.total} steps done` : 'Store setup'}
            style={s.progressThread}
          />
          {!allDone && next && (
            <Text style={s.progressNext}>
              Next: <Text style={{ color: colors.accentForeground }}>{next.label}</Text>
            </Text>
          )}
          {allDone && (
            <Text style={[s.progressNext, { color: theme.text }]}>
              ✓ All required steps complete
            </Text>
          )}
        </GradientCard>

        {/* All done card */}
        {allDone && (
          <GradientCard
            colors={[colors.accent, colors.card]}
            style={{ marginBottom: SP.md, borderColor: theme.border }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
              <View style={s.doneIcon}>
                <Icon name="check-circle" size={ICON.lg} color={theme.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { fontSize: FS.md }]}>Your store is ready</Text>
                <Text style={s.subtitle}>All required steps are complete. Your store is ready to publish.</Text>
              </View>
            </View>
            <PrimaryButton
              label="Go to dashboard"
              // navigate (not replace): pops the root stack back to the existing
              // (tabs) scene on the Dashboard tab instead of stacking a new one.
              onPress={() => router.navigate('/(tabs)/' as never)}
              icon="home"
              style={{ marginTop: SP.md }}
            />
          </GradientCard>
        )}

        {/* Task checklist — the counted launch steps */}
        <SectionHeader title="Launch checklist" style={{ marginBottom: SP.sm }} />

        {!checklist && (
          <View style={s.loading}>
            {checklistError ? (
              <>
                <Text style={s.progressNext}>Couldn't load your setup steps.</Text>
                <SecondaryButton label="Try again" small onPress={() => { void reloadChecklist(); }} />
              </>
            ) : (
              <ActivityIndicator color={theme.muted} />
            )}
          </View>
        )}

        {launchRows.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            active={next?.id === task.id}
            onComplete={handleComplete}
            onSkip={handleSkip}
            onPress={openTask}
          />
        ))}

        {extraRows.length > 0 && (
          <>
            <SectionHeader title="Grow your store" style={{ marginTop: SP.md, marginBottom: SP.sm }} />
            {extraRows.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                active={false}
                onComplete={handleComplete}
                onSkip={handleSkip}
                onPress={openTask}
              />
            ))}
          </>
        )}

        {/* Save and exit */}
        <SecondaryButton
          label="Save and exit"
          onPress={() => goBackOr(router)}
          style={{ marginTop: SP.lg }}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  title:        { fontSize: 28, lineHeight: 34, fontFamily: FONT.bold, color: colors.foreground, letterSpacing: -0.7 },
  subtitle:     { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  pctBadge:     { backgroundColor: colors.accent, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.primary },
  pctText:      { fontSize: FS.base, fontFamily: FONT.bold, color: colors.accentForeground },
  progressCard: { marginBottom: SP.md },
  progressThread: { width: '100%', marginBottom: SP.sm },
  progressNext: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  loading:      { alignItems: 'center', gap: SP.sm, paddingVertical: SP.lg },
  doneIcon:     { width: 48, height: 48, borderRadius: RADIUS.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});

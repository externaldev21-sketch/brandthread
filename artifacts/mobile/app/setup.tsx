/**
 * Brandthread Guided Setup Screen
 *
 * Walks the seller through 9 tasks to launch their store.
 * Progress persists via setupStore (AsyncStorage).
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Animated, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';

import {
  BG, CARD, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { withSellerSetupOrigin } from '@/lib/setupNavigation';
import {
  getSetupState, completeTask, skipTask,
  SetupState, SetupTask, SetupTaskId,
  completionPercent, nextTask, completedRequiredTaskCount,
  requiredTaskCount, isSetupComplete,
} from '@/lib/setupStore';
import { useApi } from '@/hooks/useApi';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  StatusBadge, SectionHeader,
} from '@/components/BrandthreadUI';

// ─── Task Step Card ───────────────────────────────────────────────────────────

function TaskCard({
  task, active, onComplete, onSkip, onPress,
}: {
  task: SetupTask;
  active: boolean;
  onComplete: (id: SetupTaskId) => void;
  onSkip: (id: SetupTaskId) => void;
  onPress: (task: SetupTask) => void;
}) {
  const colors = useColors();
  const ts = createTaskStyles(colors);
  const scale = useRef(new Animated.Value(1)).current;

  function handleComplete() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start(() => onComplete(task.id));
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(task); }}
        style={[
          ts.card,
          task.completed && ts.cardDone,
          active && !task.completed && ts.cardActive,
        ]}
      >
        {/* Left: check circle */}
        <TouchableOpacity
          onPress={task.completed ? undefined : handleComplete}
          style={[ts.check, task.completed && ts.checkDone]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {task.completed && <Feather name="check" size={ICON.sm} color={ON_DARK} />}
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
          <Text style={ts.desc} numberOfLines={1}>{task.description}</Text>
        </View>

        {/* Right: action */}
        {!task.completed && (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSkip(task.id); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={ts.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const createTaskStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card:       { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD,
                borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
                paddingHorizontal: SP.md, paddingVertical: 14, marginBottom: SP.sm },
  cardActive: { borderColor: colors.primary, backgroundColor: colors.accent },
  cardDone:   { opacity: 0.6 },
  check:      { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.primary,
                alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkDone:  { backgroundColor: SUCCESS, borderColor: SUCCESS },
  body:       { flex: 1 },
  labelRow:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 2 },
  label:      { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  labelDone:  { textDecorationLine: 'line-through', color: MUTED },
  desc:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  activePill: { backgroundColor: colors.primary, borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 2 },
  activePillText: { fontSize: 9, fontFamily: FONT.bold, color: colors.primaryForeground },
  skip:       { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SetupScreen() {
  const colors = useColors();
  const s = createStyles(colors);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const api = useApi();
  const [state, setState] = useState<SetupState | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    let active = true;
    const load = async () => {
      // This remains a focus refresh (the legacy contract was
      // getSetupState().then(next => {); the authenticated key is selected
      // before the read now.
      let onboardingComplete = false;
      try {
        const profile = await api.auth.me();
        onboardingComplete = profile.accountType === 'seller' && profile.onboardingComplete === true;
      } catch {
        // Preserve local progress when the profile endpoint is temporarily
        // unavailable; only the server response can complete verification.
      }
      const next = await getSetupState(userId, { onboardingComplete });
      if (!active) return;
      setState(next);
      Animated.timing(progressAnim, {
        toValue: completionPercent(next) / 100,
        duration: ANIM.slow,
        useNativeDriver: false,
      }).start();
    };
    void load();
    return () => { active = false; };
  }, [api, progressAnim, userId]));

  async function handleComplete(id: SetupTaskId) {
    const next = await completeTask(id, userId);
    setState(next);
    Animated.timing(progressAnim, {
      toValue: completionPercent(next) / 100,
      duration: ANIM.normal,
      useNativeDriver: false,
    }).start();
  }

  async function handleSkip(id: SetupTaskId) {
    const next = await skipTask(id, userId);
    setState(next);
  }

  function handleTaskPress(task: SetupTask) {
    if (task.completed) return;
    Alert.alert(task.label, task.description, [
      { text: 'Open', onPress: () => { try { router.replace(withSellerSetupOrigin(task.route) as never); } catch { /* ok */ } } },
      { text: 'Mark complete', onPress: () => handleComplete(task.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const pct = state ? completionPercent(state) : 0;
  const next = state ? nextTask(state) : null;
  const done = state ? completedRequiredTaskCount(state) : 0;
  const total = state ? requiredTaskCount(state) : 0;
  const allDone = state ? isSetupComplete(state) : false;

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={s.back}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="x" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Store setup</Text>
          <Text style={s.subtitle}>{done} of {total} required completed</Text>
        </View>
        <View style={s.pctBadge}>
          <Text style={s.pctText}>{pct}%</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + 80 }}
      >
        {/* Progress bar */}
        <GradientCard colors={[colors.accent, colors.card]} style={s.progressCard} glow>
          <View style={s.progressTrack}>
            <Animated.View
              style={[
                s.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
          {!allDone && next && (
            <Text style={s.progressNext}>
              Next: <Text style={{ color: colors.accentForeground }}>{next.label}</Text>
            </Text>
          )}
          {allDone && (
            <Text style={[s.progressNext, { color: SUCCESS }]}>
              ✓ All required steps complete — you're ready to go!
            </Text>
          )}
        </GradientCard>

        {/* All done card */}
        {allDone && (
          <GradientCard
            colors={[SUCCESS_DIM, 'rgba(16,185,129,0.03)']}
            style={{ marginBottom: SP.md, borderColor: SUCCESS + '44' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
              <View style={s.doneIcon}>
                <Feather name="check-circle" size={ICON.lg} color={SUCCESS} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.title, { fontSize: FS.md }]}>Your store is ready!</Text>
                <Text style={s.subtitle}>All required setup steps complete. Time to publish.</Text>
              </View>
            </View>
            <PrimaryButton
              label="Go to Home"
              onPress={() => router.replace('/(tabs)/' as never)}
              icon="home"
              style={{ marginTop: SP.md }}
              colors={['#10B981', '#34D399']}
            />
          </GradientCard>
        )}

        {/* Task checklist */}
        <SectionHeader title="Setup checklist" style={{ marginBottom: SP.sm }} />

        {state && state.tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            active={next?.id === task.id}
            onComplete={handleComplete}
            onSkip={handleSkip}
            onPress={handleTaskPress}
          />
        ))}

        {/* Save and exit */}
        <SecondaryButton
          label="Save and exit"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={{ marginTop: SP.lg }}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', gap: SP.md,
                  paddingHorizontal: SP.md, paddingBottom: SP.md },
  back:         { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
                  borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:        { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  subtitle:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  pctBadge:     { backgroundColor: colors.accent, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.primary },
  pctText:      { fontSize: FS.base, fontFamily: FONT.bold, color: colors.accentForeground },
  progressCard: { marginBottom: SP.md },
  progressTrack:{ height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden', marginBottom: SP.sm },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: RADIUS.pill },
  progressNext: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  doneIcon:     { width: 48, height: 48, borderRadius: RADIUS.md, backgroundColor: SUCCESS_DIM, alignItems: 'center', justifyContent: 'center' },
});

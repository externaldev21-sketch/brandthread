/**
 * First-week checklist — one quiet card (buyer: Discover; seller: Dashboard).
 *
 * Copied from Shopify's "Get ready to sell" setup guide: a title with the
 * count, then one row per step — an open dashed circle or a filled check, the
 * step, a chevron. 4 real steps computed by the server; a small Thread Cash
 * reward credited once when all are done. The X hides it forever (server
 * side). No pushes, no badges, nothing animated; it simply disappears once
 * the done state is dismissed or the first week is over.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon as Feather } from '@/components/ui/Icon';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { progressLabel, rewardLine, type FirstWeekState } from '@/lib/firstWeek';

import { FONT } from '@/lib/theme';
/** Loads the checklist on focus. `visible` is false until loaded, then follows the server. */
export function useFirstWeek() {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const [state, setState] = useState<FirstWeekState | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const hiddenRef = useRef(false);
  useEffect(() => {
    hiddenRef.current = false;
    setState(null);
    setOwnerId(null);
  }, [userId]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Re-read on every focus so steps finished elsewhere tick off. A response
  // is kept even if the effect re-ran meanwhile (the api object changes
  // identity as auth settles); only unmounting drops it.
  const load = useCallback(() => {
    if (!isSignedIn || !userId || hiddenRef.current) return;
    api.firstWeek.get()
      .then((s) => {
        if (mountedRef.current && currentUser.current === userId && !hiddenRef.current) {
          setOwnerId(userId);
          setState(s);
        }
      })
      .catch(() => {});
  }, [api, isSignedIn, userId]);
  // On mount / sign-in, and again whenever the screen regains focus
  // (in-flight reads are de-duplicated by the api client).
  useEffect(load, [load]);
  useFocusEffect(load);

  const dismiss = useCallback(() => {
    if (!isSignedIn || !userId || ownerId !== userId) return;
    hiddenRef.current = true;
    setState((prev) => (prev ? { ...prev, visible: false } : prev));
    api.firstWeek.dismiss().catch(() => {});
  }, [api, isSignedIn, userId, ownerId]);

  const accountState = isSignedIn && userId === ownerId ? state : null;
  return { state: accountState, visible: Boolean(accountState?.visible && accountState.steps.length), dismiss };
}

export function FirstWeekCard({ state, onDismiss }: { state: FirstWeekState; onDismiss: () => void }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const s = createStyles(theme);
  const reward = rewardLine(state, formatCents);

  return (
    <View style={s.card} testID="first-week-card">
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} accessibilityRole="header">
            {state.allDone ? 'All done' : 'Your first week'}
          </Text>
          <Text style={s.sub}>{state.allDone ? (reward ?? 'Every step is done') : [progressLabel(state), reward].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Hide this checklist for good"
          testID="first-week-dismiss"
        >
          <Feather name="x" size={20} color={theme.muted} />
        </Pressable>
      </View>
      {!state.allDone && (
        <View style={s.list}>
          {state.steps.map((step, i) => (
            <Pressable
              key={step.id}
              style={({ pressed }) => [s.row, i > 0 && s.rowDivider, pressed && { opacity: 0.6 }]}
              onPress={() => router.push(step.href as never)}
              accessibilityRole="button"
              accessibilityLabel={`${step.label}${step.done ? ', done' : ''}`}
              testID={`first-week-step-${step.id}`}
            >
              {step.done
                ? <View style={s.doneDot}><Feather name="check" size={12} color={theme.background} /></View>
                : <View style={s.openDot} />}
              <Text style={[s.rowText, step.done && s.rowTextDone]} numberOfLines={1}>{step.label}</Text>
              {!step.done && <Feather name="chevron-right" size={18} color={theme.subtle} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    backgroundColor: theme.card, paddingTop: 14, paddingBottom: 4,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingBottom: 10, gap: 12 },
  title: { fontSize: 17, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.2 },
  sub: { fontSize: 13, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  openDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.muted },
  doneDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text },
  rowText: { flex: 1, fontSize: 15, color: theme.text },
  rowTextDone: { color: theme.muted, textDecorationLine: 'line-through' },
});

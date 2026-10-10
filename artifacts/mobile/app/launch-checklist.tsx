/**
 * Launch checklist — Shopify-style setup guide for a seller's store. Done flags
 * come from the server (GET /api/seller/launch-checklist); each open step has
 * one primary action that routes to the screen that completes it.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { hapticLight } from '@/lib/haptics';
import { LAUNCH_STEP_META, nextLaunchStep, type LaunchStepId } from '@/lib/launchChecklist';
import { COMP, FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { crispPx } from '@/lib/crispPixel';

export default function LaunchChecklistScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  // Seller bar (Studio + AI side circles) floats over every seller screen.
  const tabBarInset = useTabBarMetrics(2).occupiedHeight;
  const router = useRouter();
  const { checklist, error, reload } = useLaunchChecklist();
  const [open, setOpen] = useState<LaunchStepId | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Start with the next open step expanded; after that the seller drives it.
  useEffect(() => {
    if (checklist && !seeded) {
      setOpen(nextLaunchStep(checklist));
      setSeeded(true);
    }
  }, [checklist, seeded]);

  return (
    <View style={s.root}>
      <ScreenHeader title="Launch your store" />
      {!checklist ? (
        <View style={s.center}>
          {error ? (
            <Button label="Try again" variant="secondary" size="small" onPress={reload} />
          ) : (
            <ActivityIndicator color={theme.muted} />
          )}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingBottom: tabBarInset + SP.xl }]}
        >
          <View style={s.pill}>
            <Text style={s.pillText}>{checklist.doneCount} / {checklist.total} completed</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${(checklist.doneCount / checklist.total) * 100}%` }]} />
          </View>

          <View style={s.card}>
            {checklist.steps.map((step, i) => {
              const meta = LAUNCH_STEP_META[step.id];
              const expanded = open === step.id;
              return (
                <View key={step.id} style={[s.row, i > 0 && s.rowDivider]}>
                  <PressableScale
                    onPress={() => { hapticLight(); setOpen(expanded ? null : step.id); }}
                    accessibilityLabel={`${meta.title}${step.done ? ', done' : ''}`}
                    accessibilityState={{ expanded }}
                    style={s.rowHead}
                  >
                    <View style={[s.check, step.done ? s.checkDone : s.checkOpen]}>
                      {step.done && <Feather name="check" size={ICON.xs} color={theme.onAccent} />}
                    </View>
                    <Text style={[s.rowTitle, step.done && s.rowTitleDone]}>{meta.title}</Text>
                    <Feather name={expanded ? 'chevron-up' : 'chevron-right'} size={ICON.sm} color={theme.muted} />
                  </PressableScale>
                  {expanded && (
                    <View style={s.rowBody}>
                      <Text style={s.rowText}>{meta.body}</Text>
                      <View style={s.cta}>
                        <Button
                          label={meta.cta}
                          size="small"
                          variant={step.done ? 'secondary' : 'primary'}
                          onPress={() => router.push(meta.route as never)}
                        />
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: SP.md, paddingTop: SP.md },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 3 },
  pillText: { fontSize: FS.meta, fontFamily: FONT.semibold, color: theme.text },
  track: { height: 6, borderRadius: RADIUS.pill, backgroundColor: theme.border, overflow: 'hidden', marginTop: SP.sm, marginBottom: SP.md },
  fill: { height: '100%', borderRadius: RADIUS.pill, backgroundColor: theme.accent },
  card: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.lg, overflow: 'hidden' },
  row: { paddingHorizontal: SP.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.borderSubtle },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  checkOpen: { borderWidth: crispPx(1.5), borderColor: theme.muted, borderStyle: 'dashed' },
  checkDone: { backgroundColor: theme.accent },
  rowTitle: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  rowTitleDone: { color: theme.muted },
  rowBody: { paddingLeft: 22 + SP.sm, paddingBottom: SP.md, gap: SP.sm },
  rowText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 19 },
  cta: { alignSelf: 'flex-start' },
});

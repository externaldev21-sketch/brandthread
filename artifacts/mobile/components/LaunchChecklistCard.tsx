/**
 * LaunchChecklistCard — Shopify's "Get ready to sell" card on the seller
 * dashboard (https://mobbin.com/flows/5d834cad-e1a4-4893-a1bf-e50ac56090ab,
 * last screens), reskinned: "0 / 6 completed", one row per task with a
 * dashed circle that becomes a check, each row opening its screen. Payouts
 * live here, after the first product, never during sign-up.
 * Shown until all six are done or the seller dismisses it; the full
 * checklist screen stays at /launch-checklist.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/ui';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useLaunchChecklist } from '@/hooks/useLaunchChecklist';
import { hapticLight } from '@/lib/haptics';
import { getReadyRows } from '@/lib/launchChecklist';
import { FILL_ELEVATED, FONT, SP, TEXT } from '@/lib/theme';
import { radius } from '@/constants/radii';

export default function LaunchChecklistCard() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { checklist, dismiss } = useLaunchChecklist();

  if (!checklist || checklist.dismissed) return null;
  const rows = getReadyRows(checklist);
  const doneCount = rows.filter((r) => r.done).length;
  if (doneCount === rows.length) return null;

  return (
    <View style={s.root} testID="get-ready-to-sell">
      <View style={s.header}>
        <View style={s.headerText}>
          <Text accessibilityRole="header" style={s.title}>Get ready to sell</Text>
          <Text style={s.sub}>Use this guide to get your store up and running.</Text>
        </View>
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10} style={s.close}>
          <Icon name="x" size={17} color={theme.muted} />
        </Pressable>
      </View>
      <View style={[s.pill, { borderColor: theme.border }]}>
        <Text style={s.pillText}>{doneCount} / {rows.length} completed</Text>
      </View>
      <View style={s.list}>
        {rows.map((row, i) => (
          <Pressable
            key={row.id}
            testID={`get-ready-${row.id}`}
            onPress={() => { hapticLight(); router.push(row.route as never); }}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}${row.done ? ', done' : ''}`}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
          >
            {row.done ? (
              <View style={[s.circle, s.circleDone, { backgroundColor: theme.text, borderColor: theme.text }]}>
                <Icon name="check" size={13} color={theme.background} />
              </View>
            ) : (
              <View style={[s.circle, { borderColor: theme.muted }]} />
            )}
            <View style={[s.rowBody, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
              <Text style={[s.rowTitle, row.done && { color: theme.muted }]}>{row.title}</Text>
              <Icon name="chevron-right" size={17} color={theme.muted} />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { backgroundColor: FILL_ELEVATED, borderRadius: radius.lg, marginTop: SP.xl, paddingTop: SP.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SP.md },
  headerText: { flex: 1 },
  title: { ...TEXT.headline, color: theme.text },
  sub: { ...TEXT.footnote, color: theme.muted, marginTop: 2 },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  pill: {
    alignSelf: 'flex-start', marginLeft: SP.md, marginTop: SP.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2,
  },
  pillText: { ...TEXT.caption, fontFamily: FONT.medium, color: theme.muted, fontVariant: ['tabular-nums'] },
  list: { marginTop: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: SP.md, minHeight: 52 },
  circle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', marginRight: SP.sm },
  circleDone: { borderStyle: 'solid', alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingRight: SP.md },
  rowTitle: { ...TEXT.body, color: theme.text, flex: 1 },
});

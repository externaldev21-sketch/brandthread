import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import type { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export type InboxTab = 'inbox' | 'requests';

type Theme = ReturnType<typeof useAppTheme>['theme'];

/**
 * Colors for one Inbox/Requests pill. The selected pill is a filled accent
 * pill (same treatment as the shared Chip) — never `cardElevated`, which is
 * identical to the screen background in the default monochrome theme and so
 * made the *active* tab look like plain text while the inactive one kept its
 * outline. Both states share one size/border width so siblings stay equal.
 */
export function inboxPillColors(theme: Pick<Theme, 'accent' | 'onAccent' | 'border' | 'borderSubtle' | 'muted'>, active: boolean) {
  return active
    ? {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
      label: theme.onAccent,
      countBackground: `${theme.onAccent}26`,
      countLabel: theme.onAccent,
    }
    : {
      backgroundColor: 'transparent',
      borderColor: theme.border,
      label: theme.muted,
      countBackground: theme.borderSubtle,
      countLabel: theme.muted,
    };
}

/** Threads-style Inbox / Requests chips with an optional leading filter pill. */
export function InboxPillRow({
  value, onChange, requestsCount, theme, gutter, onFilterPress, rippleEnabled,
}: {
  value: InboxTab;
  onChange: (tab: InboxTab) => void;
  requestsCount: number;
  theme: Theme;
  gutter: number;
  onFilterPress?: () => void;
  rippleEnabled?: boolean;
}) {
  const pills: { key: InboxTab; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'requests', label: 'Requests', count: requestsCount },
  ];
  return (
    <View style={[styles.row, { paddingHorizontal: gutter }]} accessibilityRole="tablist">
      {onFilterPress ? (
        <PressableScale
          style={[styles.iconPill, { borderColor: theme.border }]}
          onPress={onFilterPress}
          rippleEnabled={rippleEnabled}
          accessibilityRole="button"
          accessibilityLabel="Filter messages"
          testID="inbox-filter-pill"
        >
          <Feather name="sliders" size={15} color={theme.text} />
        </PressableScale>
      ) : null}
      {pills.map(pill => {
        const active = value === pill.key;
        const c = inboxPillColors(theme, active);
        return (
          <PressableScale
            key={pill.key}
            style={[styles.pill, { backgroundColor: c.backgroundColor, borderColor: c.borderColor }]}
            onPress={() => onChange(pill.key)}
            rippleEnabled={rippleEnabled}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            testID={`inbox-tab-${pill.key}`}
          >
            <Text style={[styles.pillLabel, { color: c.label }]}>{pill.label}</Text>
            {!!pill.count && pill.count > 0 && (
              <View style={[styles.pillCount, { backgroundColor: c.countBackground }]}>
                <Text style={[styles.pillCountText, { color: c.countLabel }]}>
                  {pill.count > 99 ? '99+' : pill.count}
                </Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  iconPill: {
    width: 36, height: 36, borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 36, paddingHorizontal: SP.md, borderRadius: RADIUS.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.1 },
  pillCount: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pillCountText: { fontSize: 11, fontFamily: FONT.bold },
});

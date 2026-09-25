/**
 * Interactive building blocks of the shared profile shell. Every control:
 *  - is at least 44pt tall/wide,
 *  - pads its label away from its own edges (no text touching borders),
 *  - shows a hover wash and a focus ring on web (keyboard + mouse),
 *  - is a single Pressable — nothing interactive is nested inside another
 *    pressable, so web never renders a button inside a button.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { SHOP_PILL_HEIGHT } from './profileLayout';

type PressState = { pressed: boolean; hovered?: boolean; focused?: boolean };
type FeatherName = keyof typeof Feather.glyphMap;

/** Hover wash + focus ring painted inside a pressable's own bounds (web only states). */
export function InteractionLayer({ state, radius, theme }: { state: PressState; radius: number; theme: AppThemePreset }) {
  return (
    <>
      {state.hovered ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: `${theme.text}14` }]} />
      ) : null}
      {state.focused ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 2, borderColor: theme.accent }]} />
      ) : null}
    </>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function ProfileButton({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const primary = variant === 'primary';
  const fg = primary ? theme.onAccent : theme.text;
  // The wrapper owns flex sizing (PressableScale styles its inner animated
  // view, not the outer Pressable), so buttons split a row evenly.
  return (
    <View style={[styles.buttonWrap, style]}>
      <PressableScale
        onPress={() => { hapticLight(); onPress(); }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !!disabled }}
        testID={testID}
        style={[
          styles.button,
          primary
            ? { backgroundColor: theme.accent, borderColor: theme.accent }
            : { backgroundColor: theme.cardGlass, borderColor: theme.border },
          disabled && styles.disabled,
        ]}
      >
        {(state) => (
          <>
            <InteractionLayer state={state as PressState} radius={RADIUS.md} theme={theme} />
            {icon ? <Feather name={icon} size={16} color={fg} /> : null}
            <Text style={[styles.buttonText, { color: fg }]} numberOfLines={1}>{label}</Text>
          </>
        )}
      </PressableScale>
    </View>
  );
}

/** Round glass control floating over the hero media (back, share, more…). */
export function ProfileGlassButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  badge,
}: {
  icon: FeatherName;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  badge?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={4}
      style={[styles.glass, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
    >
      {(state) => (
        <>
          <InteractionLayer state={state as PressState} radius={22} theme={theme} />
          <Feather name={icon} size={19} color={theme.text} />
          {badge ? <View style={[styles.glassBadge, { backgroundColor: theme.accent, borderColor: theme.background }]} /> : null}
        </>
      )}
    </PressableScale>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface ProfileStat {
  key: string;
  label: string;
  value: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/**
 * Equal-width stat cells — number over label, both centered in their cell —
 * so counts line up in one row no matter how wide each number is.
 */
export function ProfileStatsRow({ stats, loading }: { stats: ProfileStat[]; loading?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.statsRow, { borderColor: theme.border }]}>
      {stats.map((stat, index) => {
        const content = (
          <>
            <Text style={[styles.statValue, { color: loading ? theme.subtle : theme.text }]} numberOfLines={1}>
              {loading ? '–' : stat.value}
            </Text>
            <Text style={[styles.statLabel, { color: theme.muted }]} numberOfLines={1}>{stat.label}</Text>
          </>
        );
        return (
          <React.Fragment key={stat.key}>
            {index > 0 ? <View style={[styles.statDivider, { backgroundColor: theme.border }]} /> : null}
            {/* Every cell has the same wrapper + inner box so values and labels
                sit on one baseline whether or not the stat is tappable. */}
            {stat.onPress ? (
              <View style={styles.statSlot}>
                <PressableScale
                  style={styles.statCell}
                  onPress={() => { hapticSelection(); stat.onPress?.(); }}
                  accessibilityRole="button"
                  accessibilityLabel={stat.accessibilityLabel ?? `${stat.value} ${stat.label}`}
                  testID={`profile-stat-${stat.key}`}
                >
                  {(state) => (
                    <>
                      <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />
                      {content}
                    </>
                  )}
                </PressableScale>
              </View>
            ) : (
              <View style={styles.statSlot}>
                <View
                  style={styles.statCell}
                  accessible
                  accessibilityLabel={stat.accessibilityLabel ?? `${stat.value} ${stat.label}`}
                  testID={`profile-stat-${stat.key}`}
                >
                  {content}
                </View>
              </View>
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

export interface ProfileTab {
  key: string;
  label: string;
  icon: FeatherName;
  count?: number;
}

/**
 * Equal-width tabs with the icon stacked above the label, so four tabs fit a
 * 375pt phone without icons colliding into their labels. The active tab is
 * marked with a short accent "stitch" under the label.
 */
export function ProfileTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: ProfileTab[];
  active: string;
  onChange: (key: string) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.tabs, { borderColor: theme.border, backgroundColor: theme.background }]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? theme.text : theme.muted;
        return (
          <View key={tab.key} style={styles.flexCell}>
            <PressableScale
              style={styles.tab}
              onPress={() => { hapticSelection(); onChange(tab.key); }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${tab.label} tab`}
              testID={`profile-tab-${tab.key.toLowerCase()}`}
            >
              {(state) => (
                <>
                  <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />
                  <Feather name={tab.icon} size={17} color={color} />
                  <Text style={[styles.tabLabel, { color }, selected && styles.tabLabelActive]} numberOfLines={1}>
                    {tab.label}{typeof tab.count === 'number' && tab.count > 0 ? ` ${tab.count}` : ''}
                  </Text>
                  <View style={[styles.tabStitch, { backgroundColor: selected ? theme.accent : 'transparent' }]} />
                </>
              )}
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

/** "VIDEOS · 24" with the stitched thread either side — the grid's heading. */
export function ProfileSectionLabel({ label, count }: { label: string; count?: number }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.section} accessibilityRole="header">
      <View style={[styles.sectionStitch, { borderColor: theme.border }]} />
      <Text style={[styles.sectionText, { color: theme.muted }]}>
        {label}{typeof count === 'number' ? ` · ${count}` : ''}
      </Text>
      <View style={[styles.sectionStitch, { borderColor: theme.border }]} />
    </View>
  );
}

// ─── Floating shop pill ───────────────────────────────────────────────────────

/** Floating "Shop N products" call to action (Shop / Whering style sticky CTA). */
export function ShopPill({
  label,
  sublabel,
  onPress,
  bottom,
  testID = 'profile-shop-pill',
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  bottom: number;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View pointerEvents="box-none" style={[styles.pillWrap, { bottom }]}>
      <PressableScale
        onPress={() => { hapticLight(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
        testID={testID}
        style={[styles.pill, { backgroundColor: theme.accent, shadowColor: theme.shadowColor }]}
      >
        {(state) => (
          <>
            <InteractionLayer state={state as PressState} radius={RADIUS.pill} theme={theme} />
            <View style={[styles.pillIcon, { backgroundColor: `${theme.onAccent}14` }]}>
              <Feather name="shopping-bag" size={16} color={theme.onAccent} />
            </View>
            <View style={styles.pillCopy}>
              <Text style={[styles.pillLabel, { color: theme.onAccent }]} numberOfLines={1}>{label}</Text>
              {sublabel ? <Text style={[styles.pillSub, { color: theme.onAccent }]} numberOfLines={1}>{sublabel}</Text> : null}
            </View>
            <Feather name="arrow-right" size={17} color={theme.onAccent} />
          </>
        )}
      </PressableScale>
    </View>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

/** Small non-interactive pill (role, plan, "Follows you"…). */
export function ProfileChip({ label, icon, tone = 'muted' }: { label: string; icon?: FeatherName; tone?: 'muted' | 'accent' | 'warning' }) {
  const { theme } = useAppTheme();
  const color = tone === 'accent' ? theme.accent : tone === 'warning' ? theme.warning : theme.muted;
  return (
    <View style={[styles.chip, { borderColor: tone === 'muted' ? theme.border : `${color}66`, backgroundColor: theme.cardGlass }]}>
      {icon ? <Feather name={icon} size={11} color={color} /> : null}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Horizontal rail of chips/cards that must never wrap into a second row. */
export function ProfileRail({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonWrap: { flex: 1 },
  flexCell: { flex: 1 },
  button: {
    minHeight: 46, borderRadius: RADIUS.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SP.xs, paddingHorizontal: SP.md, overflow: 'hidden',
  },
  buttonText: { fontFamily: FONT.semibold, fontSize: FS.sm, flexShrink: 1 },
  disabled: { opacity: 0.5 },

  glass: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  glassBadge: { position: 'absolute', top: 9, right: 9, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },

  statsRow: {
    flexDirection: 'row', alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: SP.md, paddingVertical: SP.xs,
  },
  statSlot: { flex: 1, justifyContent: 'center' },
  statCell: { height: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xs, gap: 2 },
  statValue: { fontFamily: FONT.bold, fontSize: FS.lg, lineHeight: 24, letterSpacing: -0.3 },
  statLabel: { fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: SP.sm },

  tabs: {
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP.xs,
  },
  tab: { minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: SP.sm, paddingHorizontal: 2 },
  tabLabel: { fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14 },
  tabLabelActive: { fontFamily: FONT.semibold },
  tabStitch: { width: 18, height: 2, borderRadius: 1, marginTop: 2 },

  section: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.sm },
  sectionStitch: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  sectionText: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1.6, textTransform: 'uppercase' },

  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: SP.md },
  pill: {
    height: SHOP_PILL_HEIGHT, minWidth: 220, maxWidth: 420, borderRadius: RADIUS.pill,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingLeft: 6, paddingRight: SP.lg, overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 18, elevation: 8,
  },
  pillIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pillCopy: { flexShrink: 1, flexGrow: 1 },
  pillLabel: { fontFamily: FONT.bold, fontSize: FS.base, lineHeight: 19 },
  pillSub: { fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 14, opacity: 0.72 },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  chipText: { fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 14 },

  rail: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingHorizontal: SP.md },
});

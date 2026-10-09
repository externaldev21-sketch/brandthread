/**
 * Interactive building blocks of the shared profile shell. Every control:
 *  - is at least 44pt tall/wide,
 *  - pads its label away from its own edges (no text touching borders),
 *  - shows a hover wash and a focus ring on web (keyboard + mouse),
 *  - is a single Pressable — nothing interactive is nested inside another
 *    pressable, so web never renders a button inside a button.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle, type GestureResponderEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { haptics } from '@/lib/haptics';
import { SHOP_PILL_HEIGHT } from './profileLayout';
import { radius } from '@/constants/radii';

type PressState = { pressed: boolean; hovered?: boolean; focused?: boolean };
type FeatherName = keyof typeof Feather.glyphMap;

/**
 * Hover wash, press fill and keyboard-focus glow, all painted INSIDE a
 * pressable's own bounds (never an outer ring — a hard border-width ring
 * used to render here for the focused state, which on the monochrome theme
 * is a near-white accent and read as a plain white outline touching
 * whatever sat above a tightly packed row like the profile tabs). The
 * pressed and focused washes are both theme.accent at low opacity — a soft
 * tint, never a hard line — and the pressed one fades in/out with the
 * press itself instead of appearing instantly.
 */
export function InteractionLayer({ state, radius, theme }: { state: PressState; radius: number; theme: AppThemePreset }) {
  return (
    <>
      {state.hovered ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: `${theme.text}14` }]} />
      ) : null}
      {state.pressed ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: `${theme.accent}22` }]} />
      ) : null}
      {state.focused ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: `${theme.accent}1F`, borderWidth: 1, borderColor: `${theme.accent}55` }]} />
      ) : null}
    </>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function ProfileButton({
  label,
  icon,
  onPress,
  onLongPress,
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
  onLongPress?: () => void;
  /**
   * 'primary' — accent fill, for the one standout action in a row.
   * 'secondary' — translucent glass fill.
   * 'neutral' — solid `theme.cardElevated` fill, no accent — the buyer
   * own-profile's Edit/Share row look (see app/(buyer)/profile.tsx), used
   * where every button in the row should read as equally weighted rather
   * than one being visually promoted above the others.
   */
  variant?: 'primary' | 'secondary' | 'neutral';
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
        onPress={() => onPress()}
        onLongPress={onLongPress ? () => { haptics.rigid(); onLongPress(); } : undefined}
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
            : variant === 'neutral'
              ? { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }
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

/**
 * Own-profile action row (seller): a compact "Edit" button on the left
 * (black + 1pt silver border, white text) and one long white "Messages"
 * button filling the rest of the row (black text, unread badge) — Dev's
 * call replacing the previous three-button Edit/Share/Contact row. Both
 * controls are 38-40pt tall with a 10pt radius and a 44pt hit area (padded
 * via hitSlop rather than growing the visible pill), Inter 600 labels.
 */
export function ProfileEditMessagesRow({
  onEdit,
  onEditLongPress,
  onMessages,
  unreadCount = 0,
}: {
  onEdit: () => void;
  onEditLongPress?: () => void;
  onMessages: () => void;
  unreadCount?: number;
}) {
  const { theme } = useAppTheme();
  const hitSlop = { top: 3, bottom: 3, left: 3, right: 3 };
  return (
    <View style={styles.editMessagesRow}>
      {/* Two EQUAL columns (Dev): Edit and Messages each sit in a flex:1
          wrapper — see the comment below for why the wrapper, not the
          PressableScale, carries the flex. Same 39pt height. */}
      <View style={styles.editBtnWrap}>
        <PressableScale
          onPress={() => onEdit()}
          onLongPress={onEditLongPress ? () => { haptics.rigid(); onEditLongPress(); } : undefined}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          accessibilityHint="Opens your full profile editor. Long press to quickly edit brand name and bio."
          testID="profile-edit-details"
          hitSlop={hitSlop}
          style={[styles.editBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          {(state) => (
            <>
              <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />
              <Text style={[styles.editMessagesLabel, { color: theme.text }]} numberOfLines={1}>Edit</Text>
            </>
          )}
        </PressableScale>
      </View>
      {/* PressableScale forwards a plain-object `style` only to its INNER
          Animated.View, never to the outer Pressable that actually
          participates in this row's flex layout (see its own comment) — so
          `flex: 1` on messagesBtn alone never reached the real layout
          participant, and this button rendered barely wider than Edit
          instead of filling the row. Wrapping it in a plain flex:1 View
          (the same indirection ProfileButton's own buttonWrap already
          relies on) gives the flex to an element that actually gets it. */}
      <View style={styles.messagesBtnWrap}>
        <PressableScale
          onPress={() => onMessages()}
          accessibilityRole="button"
          accessibilityLabel={unreadCount > 0 ? `Messages, ${unreadCount} unread` : 'Messages'}
          accessibilityHint="Opens your buyer messages"
          testID="profile-messages-btn"
          hitSlop={hitSlop}
          style={[styles.messagesBtn, { backgroundColor: theme.accent }]}
        >
          {(state) => (
            <>
              <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />
              <Text style={[styles.editMessagesLabel, { color: theme.onAccent }]} numberOfLines={1}>Messages</Text>
              {unreadCount > 0 && (
                <View style={[styles.messagesBadge, { backgroundColor: theme.card }]}>
                  <Text style={[styles.messagesBadgeText, { color: theme.text }]}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </>
          )}
        </PressableScale>
      </View>
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
  /** Receives the press event so a ⋯ button can anchor its pull-down menu. */
  onPress: (event?: GestureResponderEvent) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  badge?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={(event) => onPress(event)}
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

// ─── Wallet chip ──────────────────────────────────────────────────────────────

/**
 * Compact Thread Cash balance pill for the profile's top bar ("$ 12.50").
 * Display only — tapping opens the existing wallet screen; P2P stays off.
 * ProfileShell renders it only on the viewer's own profile.
 */
export function ProfileWalletChip({ balanceLabel, onPress }: { balanceLabel: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={() => onPress()}
      accessibilityRole="button"
      accessibilityLabel={`Thread Cash wallet, ${balanceLabel}`}
      testID="profile-wallet-chip"
      hitSlop={4}
      style={[styles.walletChip, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
    >
      {(state) => (
        <>
          <InteractionLayer state={state as PressState} radius={radius.md} theme={theme} />
          <ThreadCashBillIcon size={20} />
          <Text style={[styles.walletText, { color: theme.text }]} numberOfLines={1}>{balanceLabel}</Text>
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
                  onPress={() => stat.onPress?.()}
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

/** TikTok's own-profile active-tab bar width (Mobbin reference) — short, centered under the icon. */
const ICON_TAB_INDICATOR_WIDTH = 26;

/**
 * Equal-width tabs with the icon stacked above the label, so four tabs fit a
 * 375pt phone without icons colliding into their labels. The active tab is
 * marked by an animated pill indicator that slides to whichever tab is
 * pressed, instead of each tab drawing its own static mark.
 *
 * `variant="iconOnly"` is TikTok's own-profile treatment (matched 1:1 from
 * Mobbin): icons only (the label stays as the accessibility label), evenly
 * spaced, with a short ~26pt, 2pt, rounded bar centered under the active
 * icon — not a full-cell-width underline — and no divider line below the
 * row (TikTok's own profile tab row has none). Selection and press are
 * marked ONLY by that underline and the icon's own opacity/scale dimming
 * (PressableScale's built-in press feedback, ripple disabled) — no
 * translucent background/pill/circle behind the icon at all, on press or
 * selected. The default `labeled` look (full-cell underline + hairline
 * divider + InteractionLayer press/hover wash) is unchanged for every
 * other caller.
 */
export function ProfileTabs({
  tabs,
  active,
  onChange,
  variant = 'labeled',
}: {
  tabs: ProfileTab[];
  active: string;
  onChange: (key: string) => void;
  variant?: 'labeled' | 'iconOnly';
}) {
  const iconOnly = variant === 'iconOnly';
  const { theme } = useAppTheme();
  const [rowWidth, setRowWidth] = useState(0);
  const activeIndex = Math.max(tabs.findIndex((tab) => tab.key === active), 0);
  const indicatorX = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.timing(indicatorX, { toValue: activeIndex, duration: 150, useNativeDriver: true }).start();
  }, [activeIndex, indicatorX]);

  const cellWidth = tabs.length > 0 ? rowWidth / tabs.length : 0;
  // TikTok's own-profile indicator is a short bar centered under the icon,
  // not a full-cell-width underline — fixed at 26pt regardless of cell width.
  const indicatorWidth = iconOnly ? ICON_TAB_INDICATOR_WIDTH : Math.max(0, Math.min(cellWidth - SP.md * 2, 64));

  return (
    <View
      style={[styles.tabs, iconOnly ? styles.tabsFlush : styles.tabsDivider, { borderColor: theme.border, backgroundColor: theme.background }]}
      accessibilityRole="tablist"
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? theme.text : theme.muted;
        return (
          <View key={tab.key} style={styles.flexCell}>
            <PressableScale
              style={iconOnly ? styles.tabIconOnly : styles.tab}
              onPress={() => { haptics.selection(); onChange(tab.key); }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${tab.label} tab`}
              testID={`profile-tab-${tab.key.toLowerCase()}`}
              // Icon-only own-profile tabs (TikTok-style): no press/active
              // background at all, only the underline below marks selection
              // — PressableScale's own built-in opacity/scale dimming is the
              // only press feedback here, and its ripple is disabled since
              // that's a background fill too.
              rippleEnabled={!iconOnly}
            >
              {(state) => (
                <>
                  {iconOnly ? null : <InteractionLayer state={state as PressState} radius={RADIUS.sm} theme={theme} />}
                  <Feather name={tab.icon} size={iconOnly ? 24 : 22} color={color} />
                  {iconOnly ? null : (
                    <Text style={[styles.tabLabel, { color }, selected && styles.tabLabelActive]} numberOfLines={1}>
                      {tab.label}{typeof tab.count === 'number' && tab.count > 0 ? ` ${tab.count}` : ''}
                    </Text>
                  )}
                </>
              )}
            </PressableScale>
          </View>
        );
      })}
      {cellWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tabIndicator,
            iconOnly && styles.tabIndicatorFlat,
            {
              width: indicatorWidth,
              backgroundColor: iconOnly ? theme.text : theme.accent,
              transform: [
                {
                  translateX: indicatorX.interpolate({
                    inputRange: [0, Math.max(tabs.length - 1, 1)],
                    outputRange: [
                      cellWidth / 2 - indicatorWidth / 2,
                      cellWidth * Math.max(tabs.length - 1, 1) + cellWidth / 2 - indicatorWidth / 2,
                    ],
                  }),
                },
              ],
            },
          ]}
        />
      )}
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
  /** Distance from the screen bottom when floating; omit to render in-flow. */
  bottom?: number;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const floating = bottom !== undefined;
  // Floating CTA springs up into place once, like a sticky "Shop" bar landing.
  const rise = useRef(new Animated.Value(floating ? 1 : 0)).current;
  useEffect(() => {
    if (!floating) return;
    let cancelled = false;
    const settle = () => rise.setValue(0);
    let query: Promise<boolean> | undefined;
    try { query = AccessibilityInfo.isReduceMotionEnabled?.(); } catch { query = undefined; }
    if (!query) { settle(); return; }
    query
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) { settle(); return; }
        Animated.spring(rise, { toValue: 0, damping: 14, stiffness: 160, mass: 0.9, useNativeDriver: true }).start();
      })
      .catch(settle);
    return () => { cancelled = true; };
  }, [floating, rise]);
  const riseStyle = floating
    ? {
        opacity: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 90] }) }],
      }
    : null;

  return (
    <Animated.View pointerEvents="box-none" style={[floating ? [styles.pillWrap, { bottom }] : styles.pillInline, riseStyle]}>
      <PressableScale
        onPress={() => onPress()}
        accessibilityRole="button"
        accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
        testID={testID}
        style={[styles.pill, !floating && styles.pillFull, { backgroundColor: theme.accent, shadowColor: theme.shadowColor }]}
      >
        {(state) => (
          <>
            <InteractionLayer state={state as PressState} radius={radius.md} theme={theme} />
            <View style={[styles.pillIcon, { backgroundColor: theme.onAccent }]}>
              <Feather name="shopping-bag" size={20} color={theme.accent} />
            </View>
            <View style={styles.pillCopy}>
              <Text style={[styles.pillLabel, { color: theme.onAccent }]} numberOfLines={1}>{label}</Text>
              {sublabel ? <Text style={[styles.pillSub, { color: theme.onAccent }]} numberOfLines={1}>{sublabel}</Text> : null}
            </View>
            <View style={[styles.pillArrow, { borderColor: `${theme.onAccent}33` }]}>
              <Feather name="arrow-up-right" size={18} color={theme.onAccent} />
            </View>
          </>
        )}
      </PressableScale>
    </Animated.View>
  );
}

// ─── Chips ────────────────────────────────────────────────────────────────────

/** Small non-interactive pill (role, plan, "Follows you"…). */
export function ProfileChip({ label, icon, tone = 'muted', size = 'md' }: { label: string; icon?: FeatherName; tone?: 'muted' | 'accent' | 'warning'; size?: 'md' | 'sm' }) {
  const { theme } = useAppTheme();
  const color = tone === 'accent' ? theme.accent : tone === 'warning' ? theme.warning : theme.muted;
  return (
    <View style={[styles.chip, size === 'sm' && styles.chipSm, { borderColor: tone === 'muted' ? theme.border : `${color}66`, backgroundColor: theme.cardGlass }]}>
      {icon ? <Feather name={icon} size={size === 'sm' ? 10 : 11} color={color} /> : null}
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
    minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: SP.md, overflow: 'hidden',
  },
  buttonText: { fontFamily: FONT.bold, fontSize: FS.base, flexShrink: 1 },
  disabled: { opacity: 0.5 },

  // `width: '100%'` (not just `flex: 1`): this row is the sole child of the
  // caller's own `actionRow` View, itself sized by content along its own
  // row axis with nothing to stretch it — without an explicit full width
  // here, this row shrinks to fit Edit + Messages' unexpanded content size,
  // leaving Messages' own `flex: 1` (below) with no extra space to grow
  // into and rendering it barely wider than Edit instead of filling the row.
  editMessagesRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, width: '100%' },
  editBtnWrap: { flex: 1 },
  editBtn: {
    width: '100%', height: 39, borderRadius: RADIUS.sm, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SP.lg, overflow: 'hidden',
  },
  // The actual flex participant is messagesBtnWrap (a plain View) — see the
  // render method's comment on why PressableScale itself can't carry flex.
  messagesBtnWrap: { flex: 1 },
  messagesBtn: {
    width: '100%', height: 39, borderRadius: RADIUS.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, overflow: 'hidden',
  },
  editMessagesLabel: { fontFamily: FONT.semibold, fontSize: FS.base },
  messagesBadge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  messagesBadgeText: { fontFamily: FONT.bold, fontSize: 10 },

  glass: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  walletChip: {
    height: 44, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center',
    gap: 6, paddingLeft: 7, paddingRight: 12, overflow: 'hidden',
  },
  walletText: { fontFamily: FONT.bold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  glassBadge: { position: 'absolute', top: 9, right: 9, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },

  statsRow: {
    flexDirection: 'row', alignItems: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: SP.md, paddingBottom: SP.sm,
  },
  statSlot: { flex: 1, justifyContent: 'center' },
  statCell: { height: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xs, gap: 2 },
  statValue: { ...TYPE_SCALE.title1, ...TABULAR_NUMS, letterSpacing: -0.8 },
  statLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: SP.md },

  tabs: {
    flexDirection: 'row', paddingHorizontal: SP.xs, position: 'relative',
  },
  // Labeled tabs (every non-own-profile caller) keep the full-width hairline.
  tabsDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { minHeight: 60, alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingTop: SP.sm, paddingBottom: SP.sm, paddingHorizontal: 2 },
  tabsFlush: { paddingHorizontal: 0 },
  tabIconOnly: { height: 44, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // TikTok's short centered bar: ~26pt wide, 2pt tall, rounded.
  tabIndicatorFlat: { height: 2, borderRadius: 1 },
  tabLabel: { fontFamily: FONT.semibold, fontSize: 12, lineHeight: 15 },
  tabLabelActive: { fontFamily: FONT.bold },
  tabIndicator: { position: 'absolute', bottom: -StyleSheet.hairlineWidth, left: 0, height: 2, borderRadius: 1 },

  section: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.md },
  sectionStitch: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  sectionText: { fontFamily: FONT.bold, fontSize: FS.base, letterSpacing: 2, textTransform: 'uppercase' },

  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: SP.md },
  pillInline: { alignItems: 'stretch', paddingHorizontal: SP.md },
  pill: {
    height: SHOP_PILL_HEIGHT, minWidth: 300, maxWidth: 460, borderRadius: radius.md,
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    paddingLeft: 7, paddingRight: 7, overflow: 'hidden',
    shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.5, shadowRadius: 28, elevation: 14,
  },
  pillFull: { maxWidth: undefined, minWidth: 0, alignSelf: 'stretch' },
  pillIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  pillCopy: { flexShrink: 1, flexGrow: 1 },
  pillLabel: { fontFamily: FONT.bold, fontSize: FS.md, lineHeight: 21, letterSpacing: -0.3 },
  pillSub: { fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 14, opacity: 0.7 },
  pillArrow: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4,
  },
  chipText: { fontFamily: FONT.semibold, fontSize: FS.xs, lineHeight: 14 },
  // ~10% more compact (padding only — the 11pt text is the type floor).
  chipSm: { paddingHorizontal: 9, paddingVertical: 3, gap: 3 },

  rail: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingHorizontal: SP.md },
});

/**
 * ProfileShell — the one profile layout every profile renders into: the
 * buyer's own profile, a buyer viewed by someone else, the seller's own
 * profile tab, and a seller's public brand profile. Each role fills the same
 * slots with its own existing components (actions, stats, extras, tabs).
 *
 *   ┌──────────────────────────────┐  dominant full-bleed hero (~62% of the
 *   │ (‹)                 (↗) (⋯) │  screen): latest video playing muted (or
 *   │                              │  poster / theme gradient), floating glass
 *   │  ◉                           │  controls
 *   │  Display Name ✓              │  display-size name + handle set inside the
 *   │  @handle  [Seller]           │  hero's bottom edge
 *   ├──────────────────────────────┤  on scroll: media parallaxes and darkens,
 *   │ bio · link · location        │  identity lifts/shrinks, compact bar
 *   │  12.4K │  310  │  48  │ 4.9  │  slides down into place
 *   │ [ Follow ] [ Message ]       │  big tabular stats, 2×2 action grid
 *   │ [ Share  ] [  More   ]       │
 *   │ extras (orders, stories…)    │
 *   │ ── VIDEOS · 48 ──  / tabs    │
 *   │ ▯▯▯  hairline 9:16 video wall│
 *   └──────( ◉ Shop 12 products ↗ )┘  optional floating CTA
 *
 * On desktop web it fills the global WebAppShell column (components/web).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, FlatList, RefreshControl, StyleSheet, Text, View,
  type ListRenderItem,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useScrollReset } from '@/hooks/useScrollReset';
import { TYPE_SCALE } from '@/constants/typography';
import { ProfileHeroMedia } from './ProfileHeroMedia';
import {
  ProfileChip, ProfileSectionLabel, ProfileStatsRow, ProfileTabs, ProfileWalletChip,
  type ProfileStat, type ProfileTab,
} from './ProfileControls';
import { PROFILE_GRID_GAP, SHOP_PILL_HEIGHT, useProfileLayout } from './profileLayout';
import { computeEmptyArea } from './profileEmptyStates';
import { ProfileEmptyAreaContext } from './ProfileEmptyAreaContext';
import { loadBuyerSettings } from '@/lib/buyerSettings';
import { LiveAvatarRing } from '@/components/live/LiveAvatarRing';
import { useLiveStreamForHost, useOpenLive } from '@/lib/live/useLiveDirectory';
/** Compact sticky header height below the status bar. */
const COMPACT_BAR = 64;

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;
const AVATAR = 88;

export interface ProfileIdentity {
  name: string;
  handle?: string | null;
  initials: string;
  avatarUrl?: string | null;
  verified?: boolean;
  /** "Seller" / "Buyer" — shown as a chip beside the handle. */
  roleLabel: string;
  pronouns?: string | null;
}

export interface ProfileShellProps<T> {
  testID?: string;
  identity: ProfileIdentity;
  avatar?: {
    /** Accent ring — active story / verified. */
    ring?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
    /** Small corner badge on the avatar (e.g. "plus" to add a story). */
    badgeIcon?: keyof typeof Feather.glyphMap;
    /**
     * This profile's user id for the LIVE ring: while they are live, the
     * avatar wears a red LIVE ring and tapping it opens their stream.
     */
    liveHostId?: string | null;
  };
  hero: { videoUri?: string | null; posterUri?: string | null };
  /** Owner-only cover-video affordance ("Add cover video" / "Edit cover"), shown in the hero. */
  coverAffordance?: React.ReactNode;
  /**
   * True only when the viewer is looking at their own profile. Owner-only
   * pieces (the Thread Cash wallet chip) are gated here, never on role.
   */
  isOwnProfile?: boolean;
  /** Owner-only compact Thread Cash balance chip in the top bar. */
  walletChip?: { balanceLabel: string; onPress: () => void } | null;
  /** Floating glass controls over the hero (left: back / account switcher). */
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  /** Bio, links, badges — directly under the hero. */
  meta?: React.ReactNode;
  stats: ProfileStat[];
  statsLoading?: boolean;
  actions?: React.ReactNode;
  /** Role-specific rows between actions and content (orders, stories, drops…). */
  extras?: React.ReactNode;
  tabs?: { items: ProfileTab[]; active: string; onChange: (key: string) => void };
  /** Heading for a single-section grid ("Videos · 24") when there are no tabs. */
  section?: { label: string; count?: number };
  data: T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T, index: number) => string;
  numColumns?: number;
  /** Changing this remounts the list (needed when numColumns changes). */
  listKey: string;
  ListEmptyComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Floating call to action pinned above the bottom (e.g. the Shop pill); receives its bottom offset. */
  renderFloating?: (bottom: number) => React.ReactNode;
  /** Height a floating tab bar occupies at the bottom (including the home indicator). */
  bottomInset?: number;
}

export function ProfileShell<T>(props: ProfileShellProps<T>) {
  const {
    testID, identity, avatar, hero, coverAffordance, topLeft, topRight, meta, isOwnProfile = false, walletChip, stats, statsLoading, actions, extras,
    tabs, section, data, renderItem, keyExtractor, numColumns = 1, listKey,
    ListEmptyComponent, ListFooterComponent, onEndReached, refreshing = false, onRefresh,
    renderFloating, bottomInset = 0,
  } = props;
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const liveStreamId = useLiveStreamForHost(isOwnProfile ? null : avatar?.liveHostId);
  const openLive = useOpenLive();
  const layout = useProfileLayout();
  const { heroHeight, columnWidth } = layout;

  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollResetRef = useScrollReset<any>();
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  const [focused, setFocused] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [rightWidth, setRightWidth] = useState(0);
  const [leftWidth, setLeftWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(layout.windowHeight);
  const [tabsHeight, setTabsHeight] = useState(0);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // "Use less cellular data" → the hero shows its poster frame only.
  const [dataSaver, setDataSaver] = useState(false);
  useEffect(() => {
    let alive = true;
    loadBuyerSettings().then((settings) => { if (alive) setDataSaver(!!settings.dataSaver); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (alive) setReduceMotion(!!value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => setReduceMotion(!!value));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // Last known scroll offset, kept live off of React state so it survives the
  // list remounts below without waiting on a render.
  const lastOffsetRef = useRef(0);
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      lastOffsetRef.current = value;
      const next = value < heroHeight - 40;
      setHeroOnScreen((prev) => (prev === next ? prev : next));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, heroHeight]);

  // ── Preserve scroll position across an in-screen tab switch ─────────────
  // `listKey` changes when a tab needs a different `numColumns` (FlatList
  // can't change column count on a mounted instance — RN throws), which
  // forces the list below to remount. A remount alone would reset scroll to
  // 0, which reads as "switching tabs jumps to the top" — wrong: only a
  // fresh screen mount/focus should do that. So on every listKey change we
  // capture the last scroll offset (read from the ref above, not state, so
  // it reflects the instant *before* this render — i.e. right before the old
  // list unmounts) and restore it onto the new list right after it mounts,
  // clamped to whatever the new tab's content can actually scroll to so a
  // short tab never leaves the tab bar floating over blank space.
  const listRef = useRef<FlatList<T> | null>(null);
  const prevListKeyRef = useRef(listKey);
  const pendingOffsetRef = useRef(0);
  if (prevListKeyRef.current !== listKey) {
    pendingOffsetRef.current = lastOffsetRef.current;
    prevListKeyRef.current = listKey;
  }
  const contentHeightRef = useRef(0);
  // Jumps the list straight to `offset` (no animation, so no visible
  // scroll), clamped to what the current content can actually scroll to.
  const applyOffset = useCallback((offset: number) => {
    const maxScroll = Math.max(0, contentHeightRef.current - viewportHeight);
    const clamped = Math.max(0, Math.min(offset, maxScroll));
    lastOffsetRef.current = clamped;
    scrollY.setValue(clamped);
    if (clamped > 0 || offset > 0) listRef.current?.scrollToOffset?.({ offset: clamped, animated: false });
  }, [scrollY, viewportHeight]);
  useLayoutEffect(() => {
    if (pendingOffsetRef.current > 0) applyOffset(pendingOffsetRef.current);
    // Only re-run when the list itself remounts (a new listKey) — not on
    // every scroll or content-size change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);
  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
    // Shorter content than the current offset (e.g. the newly active tab
    // has fewer items): clamp so the tab bar pins near the top instead of
    // showing blank space below a stranded scroll position.
    const maxScroll = Math.max(0, height - viewportHeight);
    if (lastOffsetRef.current > maxScroll) applyOffset(maxScroll);
  }, [viewportHeight, applyOffset]);

  // ── Collapse-on-scroll choreography ──────────────────────────────────────
  // The hero doesn't just fade: the media parallaxes at half speed and sinks
  // into a darkening wash, the big identity block lifts and shrinks toward the
  // top bar, and the compact bar *slides down* into place as it arrives.
  const collapseEnd = Math.max(1, heroHeight - 72);
  const compactOpacity = scrollY.interpolate({
    inputRange: [collapseEnd - 90, collapseEnd - 20],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const compactSlide = scrollY.interpolate({
    inputRange: [collapseEnd - 90, collapseEnd - 20],
    outputRange: [-(insets.top + 64), 0],
    extrapolate: 'clamp',
  });
  const heroTranslate = scrollY.interpolate({
    inputRange: [-200, 0, heroHeight],
    outputRange: [-100, 0, heroHeight * 0.5],
    extrapolate: 'clamp',
  });
  const heroScale = scrollY.interpolate({
    inputRange: [-200, 0, heroHeight],
    outputRange: [1.45, 1, 1.12],
    extrapolate: 'clamp',
  });
  const heroWash = scrollY.interpolate({
    inputRange: [0, collapseEnd],
    outputRange: [0, 0.85],
    extrapolate: 'clamp',
  });
  const identityLift = scrollY.interpolate({
    inputRange: [-200, 0, collapseEnd],
    outputRange: [60, 0, -heroHeight * 0.12],
    extrapolate: 'clamp',
  });
  const identityScale = scrollY.interpolate({
    inputRange: [0, collapseEnd],
    outputRange: [1, 0.82],
    extrapolate: 'clamp',
  });
  const identityOpacity = scrollY.interpolate({
    inputRange: [collapseEnd * 0.45, collapseEnd - 30],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false }),
    [scrollY],
  );

  const heroPosterOnly = reduceMotion || dataSaver;
  const heroActive = focused && heroOnScreen && !heroPosterOnly;
  // The compact identity sits between the floating controls; when a wide
  // control (e.g. the account switcher) leaves no room for a readable name
  // (avatar + ~7 characters), only the bar shows.
  const compactLeft = SP.md + (leftWidth ? leftWidth + SP.sm : 0);
  const compactRight = Math.max(SP.md, rightWidth + SP.md + SP.sm);
  const compactRoom = columnWidth - compactLeft - compactRight;
  const floatingReserve = renderFloating ? SHOP_PILL_HEIGHT + SP.lg : 0;
  // `bottomInset` is everything a floating tab bar occupies (it already
  // includes the home indicator); never less than the device safe area.
  const bottomFloor = Math.max(bottomInset, insets.bottom, SP.sm);
  const floatingBottom = bottomFloor + SP.sm;
  const emptyArea = computeEmptyArea({
    viewportHeight,
    topChrome: insets.top + COMPACT_BAR,
    tabsHeight,
    bottomInset: bottomFloor,
    floatingReserve,
  });

  const avatarBody = (
    <View style={[styles.avatarRing, avatar?.ring && { borderColor: theme.accent }]}>
      <View style={styles.avatar}>
        {identity.avatarUrl ? (
          <CachedImage source={{ uri: identity.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={styles.avatarInitials}>{identity.initials || '•'}</Text>
        )}
      </View>
      {avatar?.badgeIcon ? (
        <View style={styles.avatarBadge}>
          <Feather name={avatar.badgeIcon} size={12} color={theme.onAccent} />
        </View>
      ) : null}
    </View>
  );
  // LIVE: red ring + tag around the avatar, and the avatar opens the stream.
  const avatarNode = (
    <LiveAvatarRing live={!!liveStreamId} size={AVATAR + 8} testID={liveStreamId ? 'profile-live-ring' : undefined}>
      {avatarBody}
    </LiveAvatarRing>
  );
  const avatarPress = liveStreamId
    ? () => openLive({ streamId: liveStreamId, hostId: avatar?.liveHostId })
    : avatar?.onPress;
  const avatarPressLabel = liveStreamId
    ? `${identity.name} is live. Watch now`
    : avatar?.accessibilityLabel ?? `${identity.name} avatar`;

  const header = (
    <View>
      {/* ── Hero ── */}
      <View style={[styles.hero, { height: heroHeight }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: heroTranslate }, { scale: heroScale }] }]}>
          <ProfileHeroMedia videoUri={hero.videoUri} posterUri={hero.posterUri} active={heroActive} height={heroHeight} posterOnly={heroPosterOnly} />
        </Animated.View>
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.background}00`, `${theme.background}40`, `${theme.background}D9`, theme.background]}
          locations={[0.3, 0.55, 0.86, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: heroWash }]} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} // theme-exempt: keeps floating controls legible over bright video
          style={[styles.topScrim, { height: insets.top + 110 }]}
        />
        {isOwnProfile && coverAffordance ? (
          <View style={[styles.coverSlot, { top: insets.top + 64 }]} pointerEvents="box-none">{coverAffordance}</View>
        ) : null}
        <Animated.View
          style={[
            styles.identity,
            { opacity: identityOpacity, transform: [{ translateY: identityLift }, { scale: identityScale }] },
          ]}
        >
          {avatarPress ? (
            <PressableScale
              onPress={avatarPress}
              accessibilityRole="button"
              accessibilityLabel={avatarPressLabel}
              testID="profile-avatar"
              style={styles.avatarPress}
            >
              {avatarNode}
            </PressableScale>
          ) : (
            <View accessible accessibilityLabel={`${identity.name} avatar`} testID="profile-avatar" style={styles.avatarPress}>{avatarNode}</View>
          )}
          {/* Display-size name: the loudest thing on the page after the video.
              The badge is nested in the text so it trails the last word when a
              long name wraps, instead of pinning to the edge. */}
          <Text
            style={styles.name}
            numberOfLines={2}
            accessibilityRole="header"
            accessibilityLabel={identity.verified ? `${identity.name}, verified` : undefined}
          >
            {identity.name}
            {identity.verified ? (
              <Text>
                {'\u00A0'}
                <Feather name="check-circle" size={26} color={theme.accent} accessibilityLabel="Verified" />
              </Text>
            ) : null}
          </Text>
          <View style={styles.handleRow}>
            {identity.handle ? <Text style={styles.handle} numberOfLines={1}>{identity.handle}</Text> : null}
            {identity.pronouns ? <Text style={styles.handleSoft} numberOfLines={1}>({identity.pronouns})</Text> : null}
            <ProfileChip label={identity.roleLabel} icon={identity.roleLabel === 'Seller' ? 'shopping-bag' : 'user'} />
          </View>
        </Animated.View>
      </View>

      {meta ? <View style={styles.meta}>{meta}</View> : null}
      <ProfileStatsRow stats={stats} loading={statsLoading} />
      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {extras ? <View style={styles.extras}>{extras}</View> : null}
      {/* Tabs get their own breathing room so a tab's press state never
          reaches the action buttons above. */}
      <View
        style={styles.tabsBlock}
        onLayout={(event) => setTabsHeight(Math.round(event.nativeEvent.layout.height))}
      >
        {tabs ? (
          <ProfileTabs tabs={tabs.items} active={tabs.active} onChange={tabs.onChange} />
        ) : section ? (
          <ProfileSectionLabel label={section.label} count={section.count} />
        ) : null}
      </View>
      <View style={{ height: PROFILE_GRID_GAP }} />
    </View>
  );

  return (
    <View style={[styles.root]} testID={testID}>
      <View
        style={[styles.column, { width: columnWidth }]}
        onLayout={(event) => setViewportHeight(Math.round(event.nativeEvent.layout.height))}
      >
        <ProfileEmptyAreaContext.Provider value={emptyArea.minHeight}>
        <AnimatedFlatList
          ref={(node: FlatList<T> | null) => {
            // Two independent mechanisms share this one FlatList instance:
            // useScrollReset resets to offset 0 on a real route-focus change
            // (tab-bar nav, push/pop), while `listRef` (below) restores each
            // in-page tab's own saved scroll offset when the tab changes
            // locally — they fire on different events and don't conflict.
            (scrollResetRef as React.MutableRefObject<FlatList<T> | null>).current = node;
            listRef.current = node;
          }}
          key={listKey}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
          ListHeaderComponent={header}
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
          onContentSizeChange={handleContentSizeChange}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: emptyArea.paddingBottom }}
          refreshControl={onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.muted} progressViewOffset={insets.top} />
          ) : undefined}
        />
        </ProfileEmptyAreaContext.Provider>

        {/* Compact sticky header — fades in once the hero scrolls away */}
        <Animated.View
          pointerEvents="none"
          style={[styles.compact, { height: insets.top + 64, paddingTop: insets.top, opacity: compactOpacity, transform: [{ translateY: compactSlide }] }]}
        >
          <View style={[styles.compactInner, { paddingLeft: compactLeft, paddingRight: compactRight }]}>
            {compactRoom >= 140 ? (
              <>
                <View style={styles.compactAvatar}>
                  {identity.avatarUrl ? (
                    <CachedImage source={{ uri: identity.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Text style={styles.compactInitials}>{identity.initials}</Text>
                  )}
                </View>
                <Text style={styles.compactName} numberOfLines={1}>{identity.name}</Text>
                {identity.verified ? <Feather name="check-circle" size={15} color={theme.accent} /> : null}
              </>
            ) : null}
          </View>
        </Animated.View>

        {/* Floating controls — always reachable, above the compact header */}
        <View pointerEvents="box-none" style={[styles.controls, { top: insets.top + SP.sm }]}>
          <View
            style={styles.controlGroup}
            onLayout={(event) => setLeftWidth(Math.round(event.nativeEvent.layout.width))}
          >
            {topLeft}
          </View>
          <View
            style={styles.controlGroup}
            onLayout={(event) => setRightWidth(Math.round(event.nativeEvent.layout.width))}
          >
            {isOwnProfile && walletChip ? <ProfileWalletChip balanceLabel={walletChip.balanceLabel} onPress={walletChip.onPress} /> : null}
            {topRight}
          </View>
        </View>

        {renderFloating ? renderFloating(floatingBottom) : null}
      </View>
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background, alignItems: 'center' },
    column: { flex: 1, backgroundColor: theme.background },
    hero: { width: '100%', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: theme.card },
    topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
    identity: {
      paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.xs,
      transformOrigin: 'left bottom',
    },
    avatarPress: { alignSelf: 'flex-start', marginBottom: SP.sm },
    avatarRing: {
      width: AVATAR + 8, height: AVATAR + 8, borderRadius: (AVATAR + 8) / 2,
      borderWidth: 2.5, borderColor: theme.text, padding: 2, backgroundColor: theme.background,
    },
    avatar: {
      width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden',
      backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    },
    avatarInitials: { ...TYPE_SCALE.title1, color: theme.text },
    avatarBadge: {
      position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15,
      backgroundColor: theme.accent, borderWidth: 3, borderColor: theme.background,
      alignItems: 'center', justifyContent: 'center',
    },
    name: {
      ...TYPE_SCALE.display, letterSpacing: -1.6, color: theme.text,
      textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12, // theme-exempt: legibility over media
    },
    handleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm },
    // Solid `theme.muted` (as `handleSoft` right below already uses) instead
    // of `color: theme.text, opacity: 0.86` — text opacity anti-aliases
    // against whatever's behind it instead of rendering as one solid color.
    handle: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.muted },
    handleSoft: { fontFamily: FONT.medium, fontSize: FS.md, color: theme.muted },

    meta: { paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: SP.md, gap: SP.xs },
    actions: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
    extras: { paddingTop: SP.md, gap: SP.md },
    tabsBlock: { paddingTop: SP.lg },
    coverSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    gridRow: { gap: PROFILE_GRID_GAP },

    compact: {
      position: 'absolute', top: 0, left: 0, right: 0,
      backgroundColor: theme.background, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    compactInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    compactAvatar: {
      width: 32, height: 32, borderRadius: 16, overflow: 'hidden',
      backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    },
    compactInitials: { fontFamily: FONT.bold, fontSize: 11, color: theme.text },
    compactName: { flexShrink: 1, fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.3, color: theme.text },

    controls: {
      position: 'absolute', left: SP.md, right: SP.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    controlGroup: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  });
}

/** Shared bio/link/location block for the `meta` slot. */
export function ProfileMeta({
  bio,
  website,
  location,
  onOpenWebsite,
  children,
}: {
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  onOpenWebsite?: (url: string) => void;
  children?: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const long = !!bio && bio.length > 140;
  return (
    <>
      {bio ? (
        <Text style={[metaStyles.bio, { color: theme.text }]} numberOfLines={expanded ? undefined : 3}>
          {bio}
        </Text>
      ) : null}
      {long ? (
        <PressableScale
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show less bio' : 'Show full bio'}
          style={metaStyles.more}
        >
          <Text style={[metaStyles.moreText, { color: theme.muted }]}>{expanded ? 'Less' : 'More'}</Text>
        </PressableScale>
      ) : null}
      {(website || location) ? (
        <View style={metaStyles.links}>
          {website ? (
            <PressableScale
              onPress={() => onOpenWebsite?.(website.startsWith('http') ? website : `https://${website}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${website}`}
              style={metaStyles.link}
            >
              <Feather name="link" size={12} color={theme.accent} />
              <Text style={[metaStyles.linkText, { color: theme.accent }]} numberOfLines={1}>{website.replace(/^https?:\/\//, '')}</Text>
            </PressableScale>
          ) : null}
          {location ? (
            <View style={metaStyles.link}>
              <Feather name="map-pin" size={12} color={theme.muted} />
              <Text style={[metaStyles.linkText, { color: theme.muted }]} numberOfLines={1}>{location}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {children}
    </>
  );
}

const metaStyles = StyleSheet.create({
  bio: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  more: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 32 },
  moreText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: SP.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, maxWidth: 260, borderRadius: RADIUS.sm },
  linkText: { fontFamily: FONT.medium, fontSize: FS.sm, flexShrink: 1 },
});

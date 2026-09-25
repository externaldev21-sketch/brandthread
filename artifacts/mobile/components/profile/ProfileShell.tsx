/**
 * ProfileShell — the one profile layout every profile renders into: the
 * buyer's own profile, a buyer viewed by someone else, the seller's own
 * profile tab, and a seller's public brand profile. Each role fills the same
 * slots with its own existing components (actions, stats, extras, tabs).
 *
 *   ┌──────────────────────────────┐  full-bleed hero: latest video playing
 *   │ (‹)                 (↗) (⋯) │  muted (or poster / theme gradient + the
 *   │                              │  onboarding thread), floating glass
 *   │  ◉  Name ✓                   │  controls, avatar + name over the media
 *   │     @handle · Seller         │
 *   ├──────────────────────────────┤  collapses into a compact sticky header
 *   │ bio · link · location        │
 *   │  12.4K  │  310  │  48  │ 4.9 │  equal-width stats
 *   │ [ Follow ] [ Message ]       │  2×2 action grid
 *   │ [ Share  ] [  More   ]       │
 *   │ extras (orders, stories…)    │
 *   │ ── VIDEOS · 48 ──  / tabs    │
 *   │ ▯▯▯  9:16 video grid         │
 *   └──────────( Shop 12 products )┘  optional floating CTA
 *
 * On desktop web the whole shell sits in a centered app column.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ProfileHeroMedia } from './ProfileHeroMedia';
import {
  ProfileChip, ProfileSectionLabel, ProfileStatsRow, ProfileTabs,
  type ProfileStat, type ProfileTab,
} from './ProfileControls';
import { PROFILE_GRID_GAP, SHOP_PILL_HEIGHT, useProfileLayout } from './profileLayout';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;
const AVATAR = 76;

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
  };
  hero: { videoUri?: string | null; posterUri?: string | null };
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
    testID, identity, avatar, hero, topLeft, topRight, meta, stats, statsLoading, actions, extras,
    tabs, section, data, renderItem, keyExtractor, numColumns = 1, listKey,
    ListEmptyComponent, ListFooterComponent, onEndReached, refreshing = false, onRefresh,
    renderFloating, bottomInset = 0,
  } = props;
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const layout = useProfileLayout();
  const { heroHeight, columnWidth, isDesktopWeb } = layout;

  const scrollY = useRef(new Animated.Value(0)).current;
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  const [focused, setFocused] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [rightWidth, setRightWidth] = useState(0);
  const [leftWidth, setLeftWidth] = useState(0);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (alive) setReduceMotion(!!value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => setReduceMotion(!!value));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const next = value < heroHeight - 40;
      setHeroOnScreen((prev) => (prev === next ? prev : next));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, heroHeight]);

  const compactOpacity = scrollY.interpolate({
    inputRange: [heroHeight - 120, heroHeight - 56],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const heroTranslate = scrollY.interpolate({
    inputRange: [-200, 0, heroHeight],
    outputRange: [-100, 0, heroHeight * 0.35],
    extrapolate: 'clamp',
  });
  const heroScale = scrollY.interpolate({
    inputRange: [-200, 0],
    outputRange: [1.45, 1],
    extrapolate: 'clamp',
  });

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false }),
    [scrollY],
  );

  const heroActive = focused && heroOnScreen && !reduceMotion;
  // The compact identity sits between the floating controls; when a wide
  // control (e.g. the account switcher) leaves no room for a readable name
  // (avatar + ~7 characters), only the bar shows.
  const compactLeft = SP.md + (leftWidth ? leftWidth + SP.sm : 0);
  const compactRight = Math.max(SP.md, rightWidth + SP.md + SP.sm);
  const compactRoom = columnWidth - compactLeft - compactRight;
  const floatingReserve = renderFloating ? SHOP_PILL_HEIGHT + SP.lg : 0;
  // `bottomInset` is everything a floating tab bar occupies (it already
  // includes the home indicator); without one, the safe area is the floor.
  const bottomFloor = bottomInset > 0 ? bottomInset : Math.max(insets.bottom, SP.sm);
  const floatingBottom = bottomFloor + SP.sm;

  const avatarNode = (
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

  const header = (
    <View>
      {/* ── Hero ── */}
      <View style={[styles.hero, { height: heroHeight }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: heroTranslate }, { scale: heroScale }] }]}>
          <ProfileHeroMedia videoUri={hero.videoUri} posterUri={hero.posterUri} active={heroActive} height={heroHeight} />
        </Animated.View>
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.background}00`, `${theme.background}66`, `${theme.background}F2`, theme.background]}
          locations={[0.35, 0.62, 0.9, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']} // theme-exempt: keeps floating controls legible over bright video
          style={[styles.topScrim, { height: insets.top + 96 }]}
        />
        <View style={styles.identity}>
          {avatar?.onPress ? (
            <PressableScale
              onPress={avatar.onPress}
              accessibilityRole="button"
              accessibilityLabel={avatar.accessibilityLabel ?? `${identity.name} avatar`}
              testID="profile-avatar"
            >
              {avatarNode}
            </PressableScale>
          ) : (
            <View accessible accessibilityLabel={`${identity.name} avatar`} testID="profile-avatar">{avatarNode}</View>
          )}
          <View style={styles.identityCopy}>
            <View style={styles.nameRow}>
              {/* The badge is nested in the name's text so it follows the last
                  word when a long name wraps, instead of pinning to the edge. */}
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
                    <Feather name="check-circle" size={18} color={theme.accent} accessibilityLabel="Verified" />
                  </Text>
                ) : null}
              </Text>
            </View>
            <View style={styles.handleRow}>
              {identity.handle ? <Text style={styles.handle} numberOfLines={1}>{identity.handle}</Text> : null}
              {identity.pronouns ? <Text style={styles.handle} numberOfLines={1}>({identity.pronouns})</Text> : null}
              <ProfileChip label={identity.roleLabel} icon={identity.roleLabel === 'Seller' ? 'shopping-bag' : 'user'} />
            </View>
          </View>
        </View>
      </View>

      {meta ? <View style={styles.meta}>{meta}</View> : null}
      <ProfileStatsRow stats={stats} loading={statsLoading} />
      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {extras ? <View style={styles.extras}>{extras}</View> : null}
      {tabs ? (
        <ProfileTabs tabs={tabs.items} active={tabs.active} onChange={tabs.onChange} />
      ) : section ? (
        <ProfileSectionLabel label={section.label} count={section.count} />
      ) : null}
      <View style={{ height: PROFILE_GRID_GAP }} />
    </View>
  );

  return (
    <View style={[styles.root]} testID={testID}>
      <View style={[styles.column, { width: columnWidth }, isDesktopWeb && styles.desktopColumn]}>
        <AnimatedFlatList
          key={listKey}
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
          ListHeaderComponent={header}
          ListEmptyComponent={ListEmptyComponent}
          ListFooterComponent={ListFooterComponent}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomFloor + floatingReserve + SP.lg }}
          refreshControl={onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.muted} progressViewOffset={insets.top} />
          ) : undefined}
        />

        {/* Compact sticky header — fades in once the hero scrolls away */}
        <Animated.View
          pointerEvents="none"
          style={[styles.compact, { height: insets.top + 60, paddingTop: insets.top, opacity: compactOpacity }]}
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
                {identity.verified ? <Feather name="check-circle" size={13} color={theme.accent} /> : null}
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
    desktopColumn: {
      borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    hero: { width: '100%', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: theme.card },
    topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
    identity: {
      flexDirection: 'row', alignItems: 'flex-end', gap: SP.md,
      paddingHorizontal: SP.md, paddingBottom: SP.md,
    },
    avatarRing: {
      width: AVATAR + 8, height: AVATAR + 8, borderRadius: (AVATAR + 8) / 2,
      borderWidth: 2, borderColor: theme.border, padding: 2, backgroundColor: theme.background,
    },
    avatar: {
      width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden',
      backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    },
    avatarInitials: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text },
    avatarBadge: {
      position: 'absolute', right: 0, bottom: 0, width: 26, height: 26, borderRadius: 13,
      backgroundColor: theme.accent, borderWidth: 2, borderColor: theme.background,
      alignItems: 'center', justifyContent: 'center',
    },
    identityCopy: { flex: 1, minWidth: 0, paddingBottom: 2, gap: SP.xs },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: {
      flexShrink: 1, fontFamily: FONT.bold, fontSize: FS.h2, lineHeight: 34, letterSpacing: -0.8, color: theme.text,
      textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6, // theme-exempt: legibility over media
    },
    handleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.xs },
    handle: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },

    meta: { paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.xs },
    actions: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.sm },
    extras: { paddingTop: SP.md, gap: SP.md },
    gridRow: { gap: PROFILE_GRID_GAP },

    compact: {
      position: 'absolute', top: 0, left: 0, right: 0,
      backgroundColor: theme.background, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    compactInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    compactAvatar: {
      width: 30, height: 30, borderRadius: 15, overflow: 'hidden',
      backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    },
    compactInitials: { fontFamily: FONT.bold, fontSize: 11, color: theme.text },
    compactName: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },

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

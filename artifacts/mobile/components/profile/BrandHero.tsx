import React, { useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP, TYPE } from '@/lib/theme';

/**
 * Shared "brand world" hero used by both the buyer-facing seller-profile
 * screen and the seller's own (tabs)/profile screen, so the two divergent
 * views of the same brand identity share one visual language: a
 * theme-driven gradient hero, large brand name typography, avatar, stats
 * row, and a scroll-collapse into a compact bar — mirroring the collapse
 * pattern in components/layout/Header.tsx.
 *
 * The differing action sets (Follow/Message vs Edit/Settings) are passed in
 * as `actions`/`topBarLeft`/`topBarRight` slots rather than hardcoded here.
 */

export const HERO_COMPACT_THRESHOLD = 150;

export interface BrandHeroStat {
  key: string;
  label: string;
  value: string;
  onPress?: () => void;
}

export interface BrandHeroProps {
  /** Animated scroll offset from the screen's ScrollView `onScroll`. */
  scrollY: Animated.Value;
  brandName: string;
  username?: string | null;
  initials: string;
  avatarImageUrl?: string | null;
  verified?: boolean;
  /** Makes the avatar tappable (e.g. seller's own view: open stories / create post). */
  onAvatarPress?: () => void;
  avatarAccessibilityLabel?: string;
  /** Optional badge rendered under the name (e.g. a subscription plan pill). */
  badge?: React.ReactNode;
  bio?: React.ReactNode;
  stats?: BrandHeroStat[];
  /** Primary action row (Follow/Message for buyers, Edit/Settings for owner). */
  actions?: React.ReactNode;
  /** Left-aligned control in the floating top bar — back button or account switcher. */
  topBarLeft?: React.ReactNode;
  /** Right-aligned icon controls in the floating top bar. */
  topBarRight?: React.ReactNode;
  /** Extra content rendered under the avatar/name block, above stats (e.g. vacation banner). */
  children?: React.ReactNode;
  testID?: string;
}

export function BrandHero({
  scrollY,
  brandName,
  username,
  initials,
  avatarImageUrl,
  verified,
  onAvatarPress,
  avatarAccessibilityLabel,
  badge,
  bio,
  stats,
  actions,
  topBarLeft,
  topBarRight,
  children,
  testID,
}: BrandHeroProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();

  const compactOpacity = scrollY.interpolate({
    inputRange: [HERO_COMPACT_THRESHOLD - 24, HERO_COMPACT_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const heroOpacity = scrollY.interpolate({
    inputRange: [0, HERO_COMPACT_THRESHOLD],
    outputRange: [0.5, 0],
    extrapolate: 'clamp',
  });

  return (
    <View testID={testID}>
      {/* Floating top bar — sits above the gradient, fixed height regardless of scroll */}
      <View style={[heroStyles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={heroStyles.topBarSide}>{topBarLeft}</View>
        <Animated.View pointerEvents="none" style={[heroStyles.compactIdentity, { opacity: compactOpacity }]}>
          <View style={[heroStyles.compactAvatar, { borderColor: theme.border, backgroundColor: theme.card }]}>
            {avatarImageUrl ? (
              <Image source={{ uri: avatarImageUrl }} style={heroStyles.compactAvatarImage} />
            ) : (
              <Text style={[heroStyles.compactAvatarInitials, { color: theme.text }]}>{initials}</Text>
            )}
          </View>
          <Text style={[heroStyles.compactName, { color: theme.text }]} numberOfLines={1}>{brandName}</Text>
        </Animated.View>
        <View style={[heroStyles.topBarSide, heroStyles.topBarSideRight]}>{topBarRight}</View>
      </View>

      {/* Gradient "brand world" backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: heroOpacity }]} pointerEvents="none">
        <LinearGradient
          colors={theme.heroGradient as unknown as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={theme.glowGradient as unknown as [string, string, ...string[]]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={[heroStyles.body, { paddingTop: insets.top + 64 }]}>
        <AvatarTouchable onPress={onAvatarPress} accessibilityLabel={avatarAccessibilityLabel ?? `${brandName} avatar`} style={heroStyles.avatarWrap}>
          {verified ? (
            <View style={[heroStyles.verifiedRing, { borderColor: theme.accent }]}>
              <View style={[heroStyles.avatar, { backgroundColor: theme.card, borderColor: theme.border }]}>
                {avatarImageUrl ? (
                  <Image source={{ uri: avatarImageUrl }} style={heroStyles.avatarImage} accessibilityLabel={`${brandName} avatar`} />
                ) : (
                  <Text style={[heroStyles.avatarInitials, { color: theme.text }]}>{initials}</Text>
                )}
              </View>
            </View>
          ) : (
            <View style={[heroStyles.avatar, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {avatarImageUrl ? (
                <Image source={{ uri: avatarImageUrl }} style={heroStyles.avatarImage} accessibilityLabel={`${brandName} avatar`} />
              ) : (
                <Text style={[heroStyles.avatarInitials, { color: theme.text }]}>{initials}</Text>
              )}
            </View>
          )}
        </AvatarTouchable>

        <View style={heroStyles.nameRow}>
          <Text style={[heroStyles.brandName, { color: theme.text }]} numberOfLines={1}>{brandName}</Text>
          {verified && (
            <Feather name="check-circle" size={16} color={theme.accent} style={{ marginLeft: 6 }} accessibilityLabel="Verified" accessibilityRole="image" />
          )}
        </View>
        {!!username && <Text style={[heroStyles.username, { color: theme.muted }]}>@{username}</Text>}
        {badge}
        {bio}
        {children}

        {actions && <View style={heroStyles.actionsRow}>{actions}</View>}

        {!!stats && stats.length > 0 && (
          <View style={[heroStyles.statsRow, { borderColor: theme.border }]}>
            {stats.map((stat, i) => {
              const StatWrap: any = stat.onPress ? TouchableOpacity : View;
              return (
                <React.Fragment key={stat.key}>
                  {i > 0 && <View style={[heroStyles.statDivider, { backgroundColor: theme.border }]} />}
                  <StatWrap style={heroStyles.statItem} onPress={stat.onPress} activeOpacity={0.7}>
                    <Text style={[heroStyles.statValue, { color: theme.text }]}>{stat.value}</Text>
                    <Text style={[heroStyles.statLabel, { color: theme.muted }]}>{stat.label}</Text>
                  </StatWrap>
                </React.Fragment>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

/** Bind a screen's scroll offset to an Animated.Value for BrandHero's `scrollY`. */
export function useBrandHeroScrollY() {
  return useRef(new Animated.Value(0)).current;
}

function AvatarTouchable({
  onPress, accessibilityLabel, style, children,
}: { onPress?: () => void; accessibilityLabel: string; style: any; children: React.ReactNode }) {
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </TouchableOpacity>
  );
}

const heroStyles = StyleSheet.create({
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, height: 56 + 44,
  },
  topBarSide: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minWidth: 40 },
  topBarSideRight: { justifyContent: 'flex-end' },
  compactIdentity: {
    position: 'absolute', left: 56, right: 56, top: 8, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
  },
  compactAvatar: {
    width: 26, height: 26, borderRadius: 13, overflow: 'hidden',
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  compactAvatarImage: { width: '100%', height: '100%' },
  compactAvatarInitials: { fontSize: 10, fontFamily: FONT.bold },
  compactName: { fontSize: FS.sm, fontFamily: FONT.semibold, maxWidth: '80%' },

  body: { alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.md },
  avatarWrap: { marginBottom: SP.md },
  verifiedRing: { borderWidth: 1.5, borderRadius: RADIUS.pill, padding: 2 },
  avatar: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 48 },
  avatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold },

  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  brandName: { ...TYPE.title, fontSize: FS.xxl, letterSpacing: -0.4 },
  username: { fontSize: FS.sm, fontFamily: FONT.medium, marginBottom: SP.sm },

  actionsRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md, alignSelf: 'stretch', justifyContent: 'center' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: SP.lg, borderTopWidth: 1, paddingTop: SP.md, alignSelf: 'stretch',
  },
  statDivider: { width: 1, height: 26, marginHorizontal: SP.md },
  statItem: { alignItems: 'center', paddingHorizontal: SP.sm },
  statValue: { fontSize: FS.md, fontFamily: FONT.bold },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
});

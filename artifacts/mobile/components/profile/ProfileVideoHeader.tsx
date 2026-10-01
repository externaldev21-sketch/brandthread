/**
 * Own-profile header with the profile video playing behind it (buyer + seller).
 * Instagram's own-profile order: avatar + stats share a row, then name /
 * @handle+chip / bio sit below it.
 *
 *   ┌──────────────────────────────┐ ← video starts at the very top (under the
 *   │ @handle ⌄        $ 🔔 ≡      │   status bar); controls respect the inset
 *   │                              │
 *   │  ◉    12      340      87    │   avatar + Posts · Followers · Following,
 *   │       Posts  Followers Following  same row, vertically centered on it
 *   ├──────────────────────────────┤ ← fade is fully solid exactly here
 *   │  Display Name                │   (on the plain solid background)
 *   │  @handle  [Buyer]             │
 *   │  bio · link                  │
 *   └──────────────────────────────┘
 *
 * The video layer is absolutely positioned *behind* the avatar+stats row and
 * sized to that row's measured height (onLayout) — a long bio, a missing
 * chip, etc. never affect it, and the fade's last stop is the literal
 * `theme.background` the rest of the page uses, ending exactly at the
 * bottom of the stats row. With no video set the same layout renders on the
 * plain background.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import { loadBuyerSettings } from '@/lib/buyerSettings';
import { ProfileHeroMedia } from './ProfileHeroMedia';
import type { ProfileStat } from './ProfileControls';
import { radius } from '@/constants/radii';

/** Share of the video layer's height (from the bottom) covered by the fade. */
export const PROFILE_VIDEO_FADE_FRACTION = 0.4;

/** Legibility shadow for text set over arbitrary video frames. */
export const OVER_MEDIA_TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)', // theme-exempt: legibility over cover media
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const;

/**
 * Reduce Motion or "Use less cellular data" → the hero shows its poster only
 * (the same two signals ProfileShell's hero already honours).
 */
export function useHeroPosterOnly(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  useEffect(() => {
    let alive = true;
    loadBuyerSettings().then((settings) => { if (alive) setDataSaver(!!settings.dataSaver); }).catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (alive) setReduceMotion(!!value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => setReduceMotion(!!value));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduceMotion || dataSaver;
}

export function ProfileVideoHeader({
  hero,
  heroActive,
  posterOnly,
  topPad,
  topBar,
  avatar,
  name,
  nameAccessory,
  handle,
  chip,
  meta,
  coverAffordance,
  stats,
  statsLoading,
  onHeroHeight,
  testID = 'profile-video-header',
}: {
  hero: { videoUri?: string | null; posterUri?: string | null };
  /** Screen focused + hero on screen (the consumer tracks both). */
  heroActive: boolean;
  posterOnly: boolean;
  /** Safe top inset for foreground content (the video itself ignores it). */
  topPad: number;
  topBar: React.ReactNode;
  avatar: React.ReactNode;
  name: string;
  /** Inline after the name (e.g. a verified check). */
  nameAccessory?: React.ReactNode;
  handle?: string | null;
  chip?: React.ReactNode;
  meta?: React.ReactNode;
  coverAffordance?: React.ReactNode;
  stats: ProfileStat[];
  statsLoading?: boolean;
  /** Reports the measured video-layer height (for scroll visibility). */
  onHeroHeight?: (height: number) => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const [heroHeight, setHeroHeight] = useState(0);
  const hasMedia = !!(hero.videoUri || hero.posterUri);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeroHeight((prev) => (prev === next ? prev : next));
    onHeroHeight?.(next);
  }, [onHeroHeight]);

  const bg = theme.background;

  return (
    <View testID={testID}>
      {hasMedia && heroHeight > 0 ? (
        <View pointerEvents="none" style={[styles.heroLayer, { height: heroHeight }]} testID="profile-video-hero">
          <ProfileHeroMedia
            videoUri={hero.videoUri ?? null}
            posterUri={hero.posterUri ?? null}
            active={heroActive}
            posterOnly={posterOnly}
            height={heroHeight}
          />
          {/* Light scrim behind the top bar only, for icon legibility. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} // theme-exempt: legibility scrim over cover media
            style={[styles.topScrim, { height: topPad + 64 }]}
          />
          {/* Fade into the page: last stop is the literal page background, so
              there is no seam where the stats row begins. */}
          <LinearGradient
            testID="profile-video-fade"
            colors={[`${bg}00`, `${bg}59`, `${bg}D9`, bg]}
            locations={[0, 0.4, 0.78, 1]}
            style={[styles.fade, { height: Math.round(heroHeight * PROFILE_VIDEO_FADE_FRACTION) }]}
          />
        </View>
      ) : null}

      <View onLayout={handleLayout} testID="profile-identity-stack">
        <View style={[styles.topBar, { paddingTop: topPad + 6 }]}>{topBar}</View>

        <View style={styles.avatarRow}>
          {avatar}
          <View style={styles.statsInline}>
            <ProfileStatColumns stats={stats} loading={statsLoading} />
          </View>
        </View>
      </View>

      {/* Below the fade, on the plain solid background — Instagram's own
          order: name, then @handle + role chip, then bio/link. */}
      <View style={styles.belowAvatarRow} testID="profile-identity-meta">
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={2} accessibilityRole="header">
          {name}
          {nameAccessory ? <Text>{' '}{nameAccessory}</Text> : null}
        </Text>
        {(handle || chip) ? (
          <View style={styles.handleRow}>
            {handle ? <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{handle}</Text> : null}
            {chip}
          </View>
        ) : null}
        {meta ? <View style={styles.meta}>{meta}</View> : null}
        {coverAffordance ? <View style={styles.coverRow}>{coverAffordance}</View> : null}
      </View>
    </View>
  );
}

/**
 * Slim owner-only "+ Add profile video" / "Edit profile video" pill (never a
 * big empty band). Plain `Pressable` with hitSlop: a comfortable tap area
 * without growing the visible box.
 */
export function ProfileVideoAffordance({
  hasVideo,
  busy,
  onAdd,
  onManage,
}: {
  hasVideo: boolean;
  busy: null | 'uploading' | 'removing';
  onAdd: () => void;
  onManage: () => void;
}) {
  const { theme } = useAppTheme();
  const label = busy === 'uploading'
    ? 'Uploading video…'
    : busy === 'removing'
      ? 'Removing video…'
      : hasVideo ? 'Edit profile video' : 'Add profile video';
  return (
    <Pressable
      onPress={hasVideo ? onManage : onAdd}
      disabled={!!busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hasVideo ? 'Change or remove your profile video' : 'Pick or record a video up to 25 seconds to play behind your profile'}
      testID="profile-cover-affordance"
      hitSlop={10}
      style={({ pressed }) => [
        styles.affordance,
        { borderColor: theme.border, backgroundColor: theme.cardGlass },
        pressed && styles.affordancePressed,
      ]}
    >
      <Feather name={!hasVideo && !busy ? 'plus' : 'film'} size={12} color={theme.text} />
      <Text style={[styles.affordanceText, { color: theme.text }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Instagram stats: number over label, left to right, each tappable when it links somewhere. */
export function ProfileStatColumns({ stats, loading }: { stats: ProfileStat[]; loading?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.statsRow} testID="profile-stats-row">
      {stats.map((stat) => {
        const label = stat.accessibilityLabel ?? `${stat.value} ${stat.label}`;
        const cellStyle = styles.statCell;
        const content = (
          <>
            <Text style={[styles.statValue, { color: loading ? theme.subtle : theme.text }]} numberOfLines={1}>
              {loading ? '–' : stat.value}
            </Text>
            <Text style={[styles.statLabel, { color: theme.muted }]} numberOfLines={1}>{stat.label}</Text>
          </>
        );
        return stat.onPress ? (
          <Pressable
            key={stat.key}
            style={({ pressed }) => [cellStyle, pressed && styles.statPressed]}
            onPress={() => { hapticSelection(); stat.onPress?.(); }}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={6}
            testID={`profile-stat-${stat.key}`}
          >
            {content}
          </Pressable>
        ) : (
          <View key={stat.key} style={cellStyle} accessible accessibilityLabel={label} testID={`profile-stat-${stat.key}`}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heroLayer: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
  },
  // Top bar → avatar row: 16pt of video between them. Avatar + stats share
  // this row, vertically centered on the avatar, per Instagram's own order.
  avatarRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: 16 },
  statsInline: { flex: 1, minWidth: 0, marginLeft: 14 },
  // Below the fade, on solid background: name → @handle+chip → bio/link.
  belowAvatarRow: { paddingHorizontal: SP.md, paddingTop: 12 },
  name: { fontFamily: FONT.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  handleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm, marginTop: 4 },
  handle: { fontFamily: FONT.medium, fontSize: 14, lineHeight: 18, flexShrink: 1 },
  meta: { paddingTop: 8, gap: 2 },
  coverRow: { paddingTop: 10, alignItems: 'flex-start' },

  affordance: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 26,
    borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10,
  },
  affordancePressed: { opacity: 0.6 },
  affordanceText: { fontFamily: FONT.semibold, fontSize: 12, lineHeight: 15 },

  // Space-around, centered columns filling the row beside the avatar —
  // Instagram's own stat treatment (not the old left-aligned fixed-gap row).
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statCell: { alignItems: 'center', minWidth: 44 },
  statPressed: { opacity: 0.6 },
  statValue: { fontFamily: FONT.bold, fontSize: 17, lineHeight: 21, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 17 },
});

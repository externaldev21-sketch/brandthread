/**
 * Profile banner header — TikTok's profile banner, copied 1:1 (buyer +
 * seller, own + visited profiles). Only rendered when the profile HAS a
 * banner; with none, every profile keeps its existing header untouched.
 *
 *   ┌──────────────────────────────┐ ← banner runs up behind the status bar,
 *   │ ✎ @handle ⌄          🔔 ≡   │   full-bleed, ~45% of the screen
 *   │                              │   (a GIF or a muted ≤10s video, both
 *   │                   (On your…) │    looping forever; poster frame first,
 *   │  Display Name           ◉+  │    paused off-screen / in background)
 *   │  @handle                     │
 *   │  12 Following  3K Followers  │ ← bottom ~42% fades into the page
 *   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   background: no visible edge
 *     bio · links · chips · tabs · grid continue below, unchanged
 *
 * Text sits on a solid dark gradient (no blur, no translucent overlay).
 */
import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { FONT, ON_DARK, ON_DARK_MUTED, SP } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import { ProfileHeroMedia } from './ProfileHeroMedia';
import type { ProfileStat } from './ProfileControls';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BANNER_FADE_FRACTION, bannerFadeStops, bannerHeroMedia, type ProfileBanner } from './profileBannerRules';

/**
 * The banner's bottom edge easing into the page background (TikTok /
 * Spotify artist header) — profile, storefront cover, Edit profile preview
 * and the crop frame all use this one fade, so what you frame is what shows.
 */
export function BannerBottomFade({
  height, fraction = BANNER_FADE_FRACTION, color, testID,
}: {
  height: number;
  fraction?: number;
  /** What the banner fades into (default: the page background). */
  color?: string;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const { colors, locations } = bannerFadeStops(color ?? theme.background);
  return (
    <LinearGradient
      pointerEvents="none"
      colors={colors as unknown as [string, string, ...string[]]}
      locations={locations as unknown as [number, number, ...number[]]}
      style={[styles.bottomScrim, { height: Math.round(height * fraction) }]}
      testID={testID ?? 'banner-bottom-fade'}
    />
  );
}

/** False while the app is in the background — banner playback pauses then (battery). */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * The banner's media, looping forever and muted: a video (or a GIF the
 * server converted to MP4) through the hero player — poster frame first, so
 * there is never a blank flash — or an unconverted GIF animated by
 * expo-image. Plays only while `active`; Reduce Motion / data saver show the
 * still poster.
 */
export function BannerMedia({
  banner, active, posterOnly, height,
}: { banner: ProfileBanner; active: boolean; posterOnly: boolean; height: number }) {
  const appActive = useAppActive();
  const playing = active && appActive;
  const media = bannerHeroMedia(banner);
  if (media.gifUri && !(posterOnly && media.posterUri)) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.backdrop]} pointerEvents="none" testID="profile-banner-gif-player">
        <CachedImage
          source={{ uri: media.gifUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          autoplay={playing && !posterOnly}
          transition={0}
        />
      </View>
    );
  }
  return (
    <ProfileHeroMedia
      videoUri={media.videoUri}
      posterUri={media.posterUri}
      active={playing}
      posterOnly={posterOnly}
      height={height}
    />
  );
}

/** Subtle dark fill of an empty banner area (own profile / Edit profile). */
const PLACEHOLDER_GRADIENT = ['#242426', '#121214'] as const; // theme-exempt: banner area reads as dark media in every theme

/**
 * Empty-banner placeholder: a subtle dark fill with a centered
 * "+ Add banner" prompt, so owners know the banner area is there. The
 * prompt sits inside `contentTop`…`contentBottom` (clear of the top bar and
 * the identity block / overlapping avatar). Owners only — visitors never see
 * an empty banner.
 */
export function BannerPlaceholder({
  onAdd,
  contentTop = 0,
  contentBottom = 0,
  testID = 'banner-placeholder',
}: {
  onAdd?: () => void;
  contentTop?: number;
  contentBottom?: number;
  testID?: string;
}) {
  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <LinearGradient colors={PLACEHOLDER_GRADIENT as unknown as [string, string]} style={StyleSheet.absoluteFill} />
      <View style={[styles.placeholderSlot, { top: contentTop, bottom: contentBottom }]} pointerEvents="box-none">
        <Pressable
          onPress={onAdd ? () => { hapticSelection(); onAdd(); } : undefined}
          disabled={!onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add banner"
          accessibilityHint="Choose a GIF or a video up to 10 seconds"
          hitSlop={12}
          style={({ pressed }) => [styles.placeholderPrompt, pressed && styles.pressed]}
          testID={`${testID}-add`}
        >
          <View style={styles.placeholderIcon}>
            <Feather name="plus" size={16} color={ON_DARK} />
          </View>
          <Text style={styles.placeholderText}>Add banner</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** TikTok's stat order on the banner: Following · Followers · Likes, then anything else. */
export function bannerStats(stats: ProfileStat[]): ProfileStat[] {
  const order = ['following', 'followers', 'likes'];
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return [...stats].sort((a, b) => rank(a.key) - rank(b.key));
}

export function ProfileBannerHeader({
  banner,
  height,
  active,
  posterOnly,
  topPad,
  topBar,
  avatar,
  note,
  name,
  nameAccessory,
  handle,
  stats,
  statsLoading,
  coversTop = false,
  onAddBanner,
  avatarSide = 'right',
  testID = 'profile-banner-header',
}: {
  /** null = owner's empty banner: a dark placeholder with "Add banner". */
  banner: ProfileBanner | null;
  /** Banner height (`bannerHeight(windowHeight)`). */
  height: number;
  /** Screen focused + banner on screen (+ Reduce Motion / data saver off). */
  active: boolean;
  posterOnly: boolean;
  /** Safe top inset for the floating top bar (the media itself ignores it). */
  topPad: number;
  /** Top bar that scrolls with the banner (own profiles). Null when the screen floats its own controls. */
  topBar?: React.ReactNode;
  /** The profile's existing avatar (story ring, "+" badge, LIVE ring…). */
  avatar: React.ReactNode;
  /** Small status bubble above the avatar ("On your mind…" / the active note). */
  note?: { text: string; placeholder?: boolean; onPress?: () => void } | null;
  name: string;
  nameAccessory?: React.ReactNode;
  handle?: string | null;
  stats: ProfileStat[];
  statsLoading?: boolean;
  /**
   * True while the profile is focused and at rest at the top
   * (bannerCoversStatusBar): the banner then runs up behind the status bar,
   * like TikTok — the app-wide status-bar strip is lifted and the clock /
   * battery turn light over the top gradient. Once it scrolls, the strip is
   * back so nothing slides under the clock.
   */
  coversTop?: boolean;
  /** Empty banner (owner): what "Add banner" opens. */
  onAddBanner?: () => void;
  /**
   * Which side the avatar (with its "+" badge and note bubble) sits on.
   * 'right' is TikTok's layout (default); 'left' mirrors it — avatar first,
   * name / @handle / stats to its right (buyer's own profile).
   */
  avatarSide?: 'left' | 'right';
  testID?: string;
}) {
  return (
    <View style={[styles.root, { height }]} testID={testID}>
      {coversTop ? <StatusBar barStyle="light-content" /> : null}
      {banner ? null : (
        <BannerPlaceholder
          onAdd={onAddBanner}
          contentTop={topPad + 52}
          contentBottom={IDENTITY_BLOCK_HEIGHT}
          testID="profile-banner-placeholder"
        />
      )}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={banner ? `profile-banner-${banner.type}` : undefined}>
        {banner ? <BannerMedia banner={banner} active={active} posterOnly={posterOnly} height={height} /> : null}
        <LinearGradient
          // Subtle top gradient: keeps the status bar (time, battery) and the
          // floating icons readable over any frame.
          colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0)']} // theme-exempt: legibility scrim over banner media
          locations={[0, 0.5, 1]}
          style={[styles.topScrim, { height: topPad + 72 }]}
        />
        {/* Soft legibility shade behind the name / stats, then the fade into the page. */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.28)']} // theme-exempt: legibility shade over banner media
          style={[styles.bottomScrim, { height: Math.round(height * 0.6) }]}
        />
        <BannerBottomFade height={height} />
      </View>

      {topBar ? <View style={[styles.topBar, { paddingTop: topPad + 6 }]}>{topBar}</View> : null}

      <View style={[styles.bottom, avatarSide === 'left' && styles.bottomMirrored]} pointerEvents="box-none" testID={`profile-banner-identity-${avatarSide}`}>
        <View style={[styles.identity, avatarSide === 'left' && styles.identityMirrored]} pointerEvents="box-none">
          <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
            {name}
            {nameAccessory ? <Text>{' '}{nameAccessory}</Text> : null}
          </Text>
          {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
          <View style={[styles.stats, avatarSide === 'left' && styles.statsMirrored]} testID="profile-banner-stats">
            {bannerStats(stats).map((stat) => {
              const label = stat.accessibilityLabel ?? `${stat.value} ${stat.label}`;
              const content = (
                <>
                  <Text style={styles.statValue} numberOfLines={1}>{statsLoading ? '–' : stat.value}</Text>
                  <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
                </>
              );
              return stat.onPress ? (
                <Pressable
                  key={stat.key}
                  onPress={() => { hapticSelection(); stat.onPress?.(); }}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  hitSlop={6}
                  style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
                  testID={`profile-stat-${stat.key}`}
                >
                  {content}
                </Pressable>
              ) : (
                <View key={stat.key} style={styles.stat} accessible accessibilityLabel={label} testID={`profile-stat-${stat.key}`}>
                  {content}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.avatarColumn} pointerEvents="box-none">
          {note ? (
            <Pressable
              onPress={note.onPress}
              disabled={!note.onPress}
              accessibilityRole={note.onPress ? 'button' : 'text'}
              accessibilityLabel={note.placeholder ? 'Post a note' : `Note: ${note.text}`}
              style={({ pressed }) => [styles.note, pressed && styles.pressed]}
              testID="profile-banner-note"
            >
              <Text style={[styles.noteText, note.placeholder && styles.notePlaceholder]} numberOfLines={2}>{note.text}</Text>
              <View style={styles.noteTail} />
            </Pressable>
          ) : null}
          {avatar}
        </View>
      </View>
    </View>
  );
}

/** Room the name / handle / stats block + avatar take at the banner's bottom. */
const IDENTITY_BLOCK_HEIGHT = 172;

/** Keeps the name / handle readable over a bright frame above the fade. */
const TEXT_SHADOW = { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 } as const; // theme-exempt: legibility over banner media

const styles = StyleSheet.create({
  placeholderSlot: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  placeholderPrompt: { alignItems: 'center', gap: 8, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  placeholderIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: ON_DARK_MUTED,
  },
  placeholderText: { fontFamily: FONT.semibold, fontSize: 14, color: ON_DARK_MUTED },
  root: { width: '100%', overflow: 'hidden', backgroundColor: '#000000' }, // theme-exempt: banner backdrop before the first frame
  backdrop: { backgroundColor: '#000000' }, // theme-exempt: banner backdrop
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
  },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, paddingBottom: SP.md,
  },
  identity: { flex: 1, minWidth: 0, marginRight: SP.md },
  // avatarSide="left": avatar first, identity to its right.
  bottomMirrored: { flexDirection: 'row-reverse' },
  identityMirrored: { marginRight: 0, marginLeft: SP.md },
  statsMirrored: { gap: 16 },
  name: { fontFamily: FONT.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, color: ON_DARK, ...TEXT_SHADOW },
  handle: { fontFamily: FONT.medium, fontSize: 15, lineHeight: 20, color: ON_DARK_MUTED, marginTop: 2, ...TEXT_SHADOW },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 20, marginTop: 12 },
  stat: { alignItems: 'flex-start', minHeight: 40, justifyContent: 'flex-end' },
  statValue: { fontFamily: FONT.bold, fontSize: 17, lineHeight: 21, color: ON_DARK, fontVariant: ['tabular-nums'], ...TEXT_SHADOW },
  statLabel: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 17, color: ON_DARK_MUTED },
  pressed: { opacity: 0.6 },
  avatarColumn: { alignItems: 'center' },
  note: {
    maxWidth: 120, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 14, backgroundColor: '#FFFFFF', // theme-exempt: TikTok's white status bubble
  },
  noteText: { fontFamily: FONT.medium, fontSize: 12, lineHeight: 15, color: '#000000', textAlign: 'center' }, // theme-exempt: on the white bubble
  notePlaceholder: { color: '#6E6E73' }, // theme-exempt: silver prompt on the white bubble
  noteTail: {
    position: 'absolute', bottom: -4, alignSelf: 'center', width: 8, height: 8,
    backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }], // theme-exempt: bubble tail
  },
});

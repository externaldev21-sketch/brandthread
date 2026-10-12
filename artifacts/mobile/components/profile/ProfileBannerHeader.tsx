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
 *   │  12 Following  3K Followers  │ ← dark bottom gradient for legibility
 *   └──────────────────────────────┘
 *     bio · links · chips · tabs · grid continue below, unchanged
 *
 * Text sits on a solid dark gradient (no blur, no translucent overlay).
 */
import React, { useEffect, useState } from 'react';
import { AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSuppressStatusBarMask } from '@/components/layout/ScreenChrome';
import { CachedImage } from '@/components/CachedImage';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT, ON_DARK, ON_DARK_MUTED, SP } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import { ProfileHeroMedia } from './ProfileHeroMedia';
import type { ProfileStat } from './ProfileControls';
import { bannerHeroMedia, type ProfileBanner } from './profileBannerRules';

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
  testID = 'profile-banner-header',
}: {
  banner: ProfileBanner;
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
  testID?: string;
}) {
  useSuppressStatusBarMask(coversTop);
  return (
    <View style={[styles.root, { height }]} testID={testID}>
      {coversTop ? <StatusBar barStyle="light-content" /> : null}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`profile-banner-${banner.type}`}>
        <BannerMedia banner={banner} active={active} posterOnly={posterOnly} height={height} />
        <LinearGradient
          // Subtle top gradient: keeps the status bar (time, battery) and the
          // floating icons readable over any frame.
          colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0)']} // theme-exempt: legibility scrim over banner media
          locations={[0, 0.5, 1]}
          style={[styles.topScrim, { height: topPad + 72 }]}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.82)']} // theme-exempt: legibility scrim over banner media
          locations={[0, 0.55, 1]}
          style={[styles.bottomScrim, { height: Math.round(height * 0.6) }]}
        />
      </View>

      {topBar ? <View style={[styles.topBar, { paddingTop: topPad + 6 }]}>{topBar}</View> : null}

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.identity} pointerEvents="box-none">
          <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
            {name}
            {nameAccessory ? <Text>{' '}{nameAccessory}</Text> : null}
          </Text>
          {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
          <View style={styles.stats} testID="profile-banner-stats">
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

const styles = StyleSheet.create({
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
  name: { fontFamily: FONT.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, color: ON_DARK },
  handle: { fontFamily: FONT.medium, fontSize: 15, lineHeight: 20, color: ON_DARK_MUTED, marginTop: 2 },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 20, marginTop: 12 },
  stat: { alignItems: 'flex-start', minHeight: 40, justifyContent: 'flex-end' },
  statValue: { fontFamily: FONT.bold, fontSize: 17, lineHeight: 21, color: ON_DARK, fontVariant: ['tabular-nums'] },
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

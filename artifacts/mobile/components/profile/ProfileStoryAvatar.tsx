/**
 * Own-profile avatar, Instagram style: a 72pt photo/initials disc inside a
 * background-coloured halo, with a 2pt accent story ring drawn outside it
 * while the owner has an active story, and a white "+" badge on the
 * bottom-right edge for adding a new story.
 *
 * Every circle is sized from `avatarGeometry()` so each box's content box is
 * exactly the next circle's diameter (see profileAvatarGeometry.ts) — the
 * three circles are concentric by construction.
 *
 * The avatar and the "+" badge are two *sibling* tap targets (never one
 * pressable nested inside another): tapping the avatar opens the active
 * story when there is one (otherwise creates one), tapping "+" always
 * creates a new story.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { avatarGeometry } from './profileAvatarGeometry';

export const STORY_BADGE_SIZE = 22;

/** A moving profile picture: muted, looping, autoplaying the instant it mounts. */
function AvatarVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => { player.play(); }, [player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      testID="profile-avatar-video"
    />
  );
}

export function ProfileStoryAvatar({
  uri,
  videoUri,
  initials,
  hasActiveStory,
  onPress,
  onLongPress,
  onPressBadge,
  accessibilityLabel,
  size,
  testID = 'profile-avatar',
}: {
  uri?: string | null;
  /** A moving profile picture — when set, this plays instead of the static `uri` (its poster frame). */
  videoUri?: string | null;
  initials: string;
  hasActiveStory: boolean;
  onPress?: () => void;
  /** Own profile: press and hold opens the account switcher (Instagram). */
  onLongPress?: () => void;
  /** Shows the white "+" badge (own profile) and handles its tap. */
  onPressBadge?: () => void;
  accessibilityLabel: string;
  size?: number;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const g = avatarGeometry(size);

  const disc = (
    <View
      testID={`${testID}-story-ring`}
      style={{
        width: g.outer, height: g.outer, borderRadius: g.outer / 2,
        borderWidth: g.storyRing,
        borderColor: hasActiveStory ? theme.accent : 'transparent',
      }}
    >
      <View
        testID={`${testID}-ring`}
        style={{
          width: g.halo, height: g.halo, borderRadius: g.halo / 2,
          borderWidth: g.haloBorder, padding: g.haloPadding,
          borderColor: theme.background, backgroundColor: theme.background,
        }}
      >
        <View
          testID={`${testID}-inner`}
          style={[styles.avatar, { width: g.avatar, height: g.avatar, borderRadius: g.avatar / 2 }]}
        >
          {videoUri ? (
            <AvatarVideo uri={videoUri} />
          ) : uri ? (
            <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <>
              <LinearGradient
                colors={['#2a2a2a', '#1a1a1a']} // theme-exempt: fixed monochrome avatar placeholder per spec
                style={StyleSheet.absoluteFill}
              />
              <Text style={[styles.initials, { color: theme.text, fontSize: Math.round(g.avatar * 0.36) }]}>{initials}</Text>
            </>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ width: g.outer, height: g.outer }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={onLongPress ? 'Press and hold to switch accounts' : undefined}
          testID={testID}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          {disc}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={accessibilityLabel} testID={testID}>{disc}</View>
      )}
      {onPressBadge ? (
        <Pressable
          onPress={onPressBadge}
          accessibilityRole="button"
          accessibilityLabel="Add to your story"
          hitSlop={6}
          testID={`${testID}-badge`}
          style={({ pressed }) => [
            styles.badge,
            { borderColor: theme.background },
            pressed && styles.pressed,
          ]}
        >
          <Feather name="plus" size={12} color="#000000" /* theme-exempt: fixed black glyph on the white badge per spec */ />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FONT.semibold },
  pressed: { opacity: 0.8 },
  badge: {
    position: 'absolute', right: 0, bottom: 0,
    width: STORY_BADGE_SIZE, height: STORY_BADGE_SIZE, borderRadius: STORY_BADGE_SIZE / 2,
    backgroundColor: '#FFFFFF', // theme-exempt: fixed white badge per spec
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
});

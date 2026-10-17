/**
 * TikTok-style spinning album/sound disc, rendered under Share on the right
 * rail. Spins only while its page is the active, playing one; still under
 * reduce-motion. Tapping toggles feed sound (same handler as the sound row).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { CachedImage } from '@/components/CachedImage';
import { ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export const SOUND_DISC_SIZE = 40;
export const SOUND_DISC_SPIN_MS = 5000;

export function shouldSpinDisc(spinning: boolean, reduceMotion?: boolean): boolean {
  return spinning && !reduceMotion;
}

export function SoundDisc({ avatarUri, avatarSource, initials, sound, spinning, reduceMotion, soundOn, onPress, testID }: {
  avatarUri?: string; avatarSource?: number; initials: string; sound: string;
  spinning: boolean; reduceMotion?: boolean; soundOn: boolean; onPress: () => void; testID?: string;
}) {
  const rot = useSharedValue(0);
  const spin = shouldSpinDisc(spinning, reduceMotion);
  React.useEffect(() => {
    if (spin) {
      rot.value = rot.value % 360;
      rot.value = withRepeat(withTiming(rot.value + 360, { duration: SOUND_DISC_SPIN_MS, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(rot);
    }
    return () => cancelAnimation(rot);
  }, [spin, rot]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.hit} accessibilityRole="button"
      accessibilityLabel={`Sound: ${sound}. ${soundOn ? 'Mute' : 'Unmute'}`} accessibilityState={{ checked: soundOn }} testID={testID}>
      <Animated.View style={[styles.disc, aStyle]}>
        <View style={styles.inner}>
          {avatarSource ? <CachedImage source={avatarSource} style={styles.fill} contentFit="cover" />
            : avatarUri ? <CachedImage source={{ uri: avatarUri }} style={styles.fill} contentFit="cover" />
            : <Text style={styles.initials}>{initials.slice(0, 2)}</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: SOUND_DISC_SIZE, height: SOUND_DISC_SIZE, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1C1C1E', borderWidth: 6, borderColor: '#2C2C2E',
  },
  inner: { width: 24, height: 24, borderRadius: RADII.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3A3A3C' },
  fill: { width: '100%', height: '100%' },
  initials: { color: ON_DARK, fontSize: 9, fontWeight: '700' },
});

import React, { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { FONT, FS, SP } from '@/lib/theme';
import { markStoryGestureGuideShown } from '@/lib/storyGestureGuideStorage';

export { shouldShowStoryGestureGuide } from '@/lib/storyGestureGuideStorage';

const { width: W } = Dimensions.get('window');

function PulseIcon({ name }: { name: keyof typeof MaterialCommunityIcons.glyphMap }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(0.82, { duration: 420, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 420, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 500 }),
      ),
      -1,
    );
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <MaterialCommunityIcons name={name} size={34} color="#FFFFFF" />
    </Animated.View>
  );
}

function SwipeIcon() {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 500, easing: Easing.inOut(Easing.quad) }),
        withTiming(10, { duration: 500, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 400 }),
      ),
      -1,
    );
  }, [x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={style}>
      <MaterialCommunityIcons name="gesture-swipe-horizontal" size={34} color="#FFFFFF" />
    </Animated.View>
  );
}

const ROWS: Array<{
  key: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}> = [
  { key: 'forward', icon: <PulseIcon name="gesture-tap" />, title: 'Go forward', body: 'Tap the screen' },
  { key: 'pause', icon: <PulseIcon name="gesture-tap-hold" />, title: 'Pause', body: 'Press and hold' },
  { key: 'back', icon: <PulseIcon name="gesture-tap-button" />, title: 'Go back', body: 'Tap the left edge' },
  { key: 'move', icon: <SwipeIcon />, title: 'Move between stories', body: 'Swipe left or right' },
];

type Props = {
  /** The signed-in user's id — used to key "shown once per account". */
  userId: string;
  onDismiss: () => void;
};

/**
 * First-time story-viewer coach screen, modeled on Instagram's "Watching
 * stories" overlay: dimmed blurred backdrop, title/subtitle, four gesture
 * rows with looping line-art icon animations, dismissed by any tap.
 */
export default function StoryGestureGuide({ userId, onDismiss }: Props) {
  const dismiss = () => {
    void markStoryGestureGuideShown(userId);
    onDismiss();
  };

  return (
    <Pressable
      testID="story-gesture-guide"
      style={StyleSheet.absoluteFill}
      onPress={dismiss}
      accessibilityRole="button"
      accessibilityLabel="Watching stories gesture guide. Tap to continue."
    >
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <View style={styles.content}>
        <Text style={styles.title}>Watching stories</Text>
        <Text style={styles.subtitle}>You can use these gestures to control playback.</Text>

        <View style={styles.rows}>
          {ROWS.map((row) => (
            <View key={row.key} style={styles.row} testID={`story-gesture-row-${row.key}`}>
              <View style={styles.iconWrap}>{row.icon}</View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowBody}>{row.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.tapToKeepWatching}>Tap to keep watching</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    textAlign: 'center',
    marginTop: SP.xs,
    maxWidth: W * 0.8,
  },
  rows: {
    marginTop: SP.xl,
    width: '100%',
    gap: SP.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
  iconWrap: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    color: '#FFFFFF',
    fontFamily: FONT.semibold,
    fontSize: FS.md,
  },
  rowBody: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    marginTop: 2,
  },
  tapToKeepWatching: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    marginTop: SP.xxl,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

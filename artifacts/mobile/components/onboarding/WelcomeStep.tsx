/**
 * Onboarding opener — Pinterest's welcome, reskinned
 * (https://mobbin.com/flows/181f0864-8d03-4f31-9aef-99dd251b93cb): real
 * product footage playing full-bleed from the top edge, then the mark, one
 * line and two buttons on plain black at the bottom. No glow, no gradient,
 * nothing laid over the video.
 *
 * The footage is the bundled runway clips the feed already ships with (no
 * network). Muted and looping; with Reduce Motion on it holds on the poster
 * frame instead of playing.
 */
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PillButton } from './OnboardingUI';
import { SPACE, TYPE, useOnboardingMotion } from './onboardingTokens';

const WELCOME_VIDEO = require('../../assets/videos/fashion_runway_02.mp4');
const WELCOME_POSTER = require('../../assets/videos/fashion_runway_02.jpg');

/** Share of the screen the footage takes; the rest is the black CTA panel. */
const VIDEO_SHARE = 0.6;

export function WelcomeStep({
  onGetStarted,
  onSignIn,
  onBrowse,
}: {
  onGetStarted: () => void;
  onSignIn: () => void;
  /** Optional guest entry (Guideline 5.1.1(v)): browse without an account. */
  onBrowse?: () => void;
}) {
  const { theme } = useAppTheme();
  const { reduceMotion } = useOnboardingMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const videoHeight = Math.round(height * VIDEO_SHARE);
  const styles = createStyles(theme);

  return (
    <View style={styles.root} testID="onboarding-welcome">
      <View style={[styles.media, { height: videoHeight }]}>
        <WelcomeFootage play={!reduceMotion} />
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + SPACE.md }]}>
        <View style={styles.brandRow}>
          <BrandthreadLogo size={40} />
          <Text style={[TYPE.title1, styles.tagline]} numberOfLines={2}>
            Where brands find their people.
          </Text>
        </View>

        <View style={styles.ctas}>
          <PillButton
            testID="onboarding-welcome-get-started"
            accessibilityLabel="Get started"
            label="Get started"
            haptic={false}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onGetStarted(); }}
          />
          <PillButton
            testID="onboarding-welcome-sign-in"
            accessibilityLabel="I already have an account"
            label="I already have an account"
            variant="secondary"
            haptic={false}
            onPress={onSignIn}
          />
          {onBrowse ? (
            <PressableScale
              testID="onboarding-welcome-browse-guest"
              accessibilityRole="button"
              accessibilityLabel="Browse as a guest"
              onPress={onBrowse}
              style={styles.guest}
            >
              <Text style={[TYPE.label, { color: theme.muted }]}>Browse as a guest</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function WelcomeFootage({ play }: { play: boolean }) {
  const player = useVideoPlayer(WELCOME_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setStarted(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (play) player.play();
    else player.pause();
  }, [play, player]);

  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        accessible={false}
      />
      {/* Poster until the first frame plays (and for Reduce Motion). */}
      {!started ? <Image source={WELCOME_POSTER} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} /> : null}
    </>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  media: { width: '100%', overflow: 'hidden', backgroundColor: theme.background },
  panel: { flex: 1, paddingHorizontal: SPACE.lg, paddingTop: SPACE.lg, justifyContent: 'space-between' },
  brandRow: { gap: SPACE.sm },
  tagline: { color: theme.text },
  ctas: { width: '100%', gap: SPACE.sm },
  guest: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACE.md },
});

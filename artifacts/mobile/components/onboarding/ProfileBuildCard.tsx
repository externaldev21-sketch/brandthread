/**
 * Onboarding — the profile card that builds as you sign up.
 *
 * Copied from Instagram's "Create a profile that shows your vibe" card: a
 * round photo with an edit badge, the @handle, then the name. During the Name
 * step it fills in live as the person types; tapping the photo adds one. On
 * the final screen the same card flips once to its back, "Your profile is
 * ready" (FlippingProfileCard). Under Reduce Motion the flip is a crossfade.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from './OnboardingUI';
import { SPACE, useOnboardingMotion } from './onboardingTokens';
import { profileInitial, type ProfileCardData } from '@/lib/profileCard';

export type { ProfileCardData };

type Theme = ReturnType<typeof useAppTheme>['theme'];

function CardFace({
  data, styles, theme, onPickPhoto, photoSize,
}: {
  data: ProfileCardData;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onPickPhoto?: () => void;
  photoSize: number;
}) {
  const initial = profileInitial(data);
  const photo = (
    <View style={{ width: photoSize, height: photoSize }}>
      <View style={[styles.photo, { width: photoSize, height: photoSize, borderRadius: photoSize / 2 }]}>
        {data.photoUri ? (
          <Image source={{ uri: data.photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={[styles.initial, { fontSize: photoSize * 0.4 }]}>{initial}</Text>
        )}
      </View>
      {onPickPhoto ? (
        <View style={styles.editBadge}>
          <Feather name={data.photoUri ? 'edit-2' : 'plus'} size={14} color={theme.background} />
        </View>
      ) : null}
    </View>
  );
  const handle = data.handle.trim().replace(/^@/, '');
  return (
    <>
      {onPickPhoto ? (
        <PressableScale
          testID="profile-card-photo"
          accessibilityRole="button"
          accessibilityLabel={data.photoUri ? 'Change profile photo' : 'Add profile photo'}
          onPress={onPickPhoto}
        >
          {photo}
        </PressableScale>
      ) : photo}
      <Text style={[styles.handle, !handle && styles.placeholder]} numberOfLines={1}>
        {handle ? `@${handle}` : '@username'}
      </Text>
      <Text style={[styles.name, !data.name.trim() && styles.placeholder]} numberOfLines={1}>
        {data.name.trim() || 'Your name'}
      </Text>
    </>
  );
}

/** The live card shown while signing up. */
export function ProfileBuildCard({ data, onPickPhoto }: { data: ProfileCardData; onPickPhoto?: () => void }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.card} testID="profile-build-card">
      <CardFace data={data} styles={styles} theme={theme} onPickPhoto={onPickPhoto} photoSize={88} />
    </View>
  );
}

/**
 * The same card on the last screen: shows the front, then flips once to
 * "Your profile is ready". Never repeats.
 */
export function FlippingProfileCard({ data, delayMs = 500, onFlipped }: { data: ProfileCardData; delayMs?: number; onFlipped?: () => void }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { reduceMotion } = useOnboardingMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [flipped, setFlipped] = useState(false);
  const onFlippedRef = useRef(onFlipped);
  onFlippedRef.current = onFlipped;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      delay: delayMs,
      duration: reduceMotion ? 200 : 620,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start(({ finished }) => {
      if (!finished) return;
      setFlipped(true);
      onFlippedRef.current?.();
    });
    return () => anim.stop();
    // Runs once: the flip never repeats on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frontStyle = reduceMotion
    ? { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
    : {
      opacity: progress.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [1, 1, 0, 0] }),
      transform: [{ perspective: 1000 }, { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
    };
  const backStyle = reduceMotion
    ? { opacity: progress }
    : {
      opacity: progress.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: [0, 0, 1, 1] }),
      transform: [{ perspective: 1000 }, { rotateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] }) }],
    };
  const handle = data.handle.trim().replace(/^@/, '');

  return (
    <View
      style={styles.flipWrap}
      testID="profile-flip-card"
      accessible
      accessibilityLabel={flipped ? `Your profile is ready. ${data.name}${handle ? `, @${handle}` : ''}` : `${data.name}${handle ? `, @${handle}` : ''}`}
    >
      <Animated.View style={[styles.card, styles.face, frontStyle]} pointerEvents="none">
        <CardFace data={data} styles={styles} theme={theme} photoSize={88} />
      </Animated.View>
      <Animated.View style={[styles.card, styles.face, styles.back, backStyle]} pointerEvents="none">
        <View style={styles.backRow}>
          <View style={[styles.photo, { width: 44, height: 44, borderRadius: 22 }]}>
            {data.photoUri
              ? <Image source={{ uri: data.photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              : <Text style={[styles.initial, { fontSize: 18 }]}>{profileInitial(data)}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.backName} numberOfLines={1}>{data.name.trim()}</Text>
            {handle ? <Text style={styles.backHandle} numberOfLines={1}>@{handle}</Text> : null}
          </View>
          <Feather name="check" size={20} color={theme.text} />
        </View>
        <Text style={styles.ready}>Your profile{'\n'}is ready</Text>
      </Animated.View>
    </View>
  );
}

const CARD_HEIGHT = 216;

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    alignItems: 'center',
    paddingVertical: SPACE.lg,
    paddingHorizontal: SPACE.md,
    borderRadius: 20,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  flipWrap: { height: CARD_HEIGHT },
  face: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: 'hidden' },
  back: { alignItems: 'stretch', justifyContent: 'space-between', paddingHorizontal: SPACE.lg },
  photo: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
  },
  initial: { color: theme.text, fontWeight: '600' },
  editBadge: {
    position: 'absolute', right: 0, bottom: 0, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text,
    borderWidth: 2, borderColor: theme.card,
  },
  handle: { marginTop: SPACE.sm, fontSize: 15, fontWeight: '600', color: theme.text, maxWidth: '100%' },
  name: { marginTop: 2, fontSize: 14, color: theme.muted, maxWidth: '100%' },
  placeholder: { color: theme.subtle },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  backName: { fontSize: 15, fontWeight: '600', color: theme.text },
  backHandle: { fontSize: 13, color: theme.muted, marginTop: 1 },
  ready: { fontSize: 34, lineHeight: 38, fontWeight: '700', color: theme.text, letterSpacing: -0.8 },
});

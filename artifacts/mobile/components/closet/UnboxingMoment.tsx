/**
 * Unboxing moment (Shop app's "Delivered" moment, reskinned): the first time
 * a buyer opens the app after an order is delivered, a box opens once (under
 * 1.2 s, tap to skip, no motion with Reduce Motion), then "Post your fit"
 * with the delivered pieces already tagged. Never shown again for that order
 * (the server stamps it the moment it is shown). No sound, no push.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui/Button';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { createFitHref, fitTagsFromPieces, pieceCaption } from '@/lib/closet';
import { hapticSuccess } from '@/lib/haptics';
import { FONT, FS, SP } from '@/lib/theme';
import { getUnboxing, markUnboxingSeen, type Unboxing } from '@/services/closetService';

const INK = '#000000';
const PAPER = '#FFFFFF';
const SILVER = '#A7A7AD';

/** Whole animation, ms — the brief caps it at 1.2 s. */
export const UNBOXING_DURATION_MS = 1100;
/** Don't ask the server again within this long of the last check. */
const RECHECK_MS = 10 * 60 * 1000;

export function UnboxingHost({ enabled }: { enabled: boolean }) {
  const flagOn = useFeatureFlag('unboxingMoment');
  const [moment, setMoment] = useState<Unboxing | null>(null);
  const lastCheck = useRef(0);
  const showing = useRef(false);

  const check = useCallback(async () => {
    if (!enabled || !flagOn || showing.current) return;
    const now = Date.now();
    if (now - lastCheck.current < RECHECK_MS) return;
    lastCheck.current = now;
    const next = await getUnboxing().catch(() => null);
    if (!next || showing.current) return;
    showing.current = true;
    setMoment(next);
    // Stamp it as seen right away: a kill mid-animation never brings it back.
    void markUnboxingSeen().catch(() => {});
  }, [enabled, flagOn]);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => sub.remove();
  }, [check]);

  const close = useCallback(() => { showing.current = false; setMoment(null); }, []);
  if (!moment) return null;
  return <UnboxingMoment moment={moment} onClose={close} />;
}

export function UnboxingMoment({ moment, onClose }: { moment: Unboxing; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const piece = moment.pieces[0];
  const more = moment.pieces.length - 1;

  // 0 → 1 over the whole moment; each layer reads its own slice of it.
  const t = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const [done, setDone] = useState(reduceMotion);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Reduce Motion (it can resolve a beat after mount): no animation, final state.
    if (reduceMotion) { anim.current?.stop(); t.setValue(1); setDone(true); return; }
    // One haptic, when the lid comes off.
    const haptic = setTimeout(() => hapticSuccess(), UNBOXING_DURATION_MS * 0.3);
    anim.current = Animated.timing(t, { toValue: 1, duration: UNBOXING_DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.current.start(({ finished }) => { if (finished) setDone(true); });
    return () => { clearTimeout(haptic); anim.current?.stop(); };
  }, [reduceMotion, t]);

  const skip = useCallback(() => {
    if (done) return;
    anim.current?.stop();
    t.setValue(1);
    setDone(true);
  }, [done, t]);

  const range = (from: number, to: number, a: number, b: number) =>
    t.interpolate({ inputRange: [0, from, to, 1], outputRange: [a, a, b, b], extrapolate: 'clamp' });

  const boxOpacity = t.interpolate({ inputRange: [0, 0.15, 0.55, 0.75], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const boxScale = range(0, 0.2, 0.9, 1);
  const lidY = range(0.2, 0.5, 0, -56);
  const lidRotate = range(0.2, 0.5, 0, -14).interpolate({ inputRange: [-14, 0], outputRange: ['-14deg', '0deg'] });
  const photoOpacity = range(0.4, 0.75, 0, 1);
  const photoY = range(0.4, 0.85, 70, 0);
  const photoScale = range(0.4, 0.85, 0.55, 1);
  const contentOpacity = range(0.8, 1, 0, 1);

  const postFit = () => {
    onClose();
    router.push(createFitHref(fitTagsFromPieces(moment.pieces)) as never);
  };

  return (
    <Modal visible transparent={false} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.root, { paddingTop: insets.top + SP.lg, paddingBottom: insets.bottom + SP.md }]} onPress={skip} accessible={false} focusable={false} testID="unboxing-moment">
        <View style={styles.stage}>
          <Animated.View style={[styles.box, { opacity: boxOpacity, transform: [{ scale: boxScale }] }]} pointerEvents="none">
            <Animated.View style={[styles.lid, { transform: [{ translateY: lidY }, { rotate: lidRotate }] }]} />
            <View style={styles.body} />
          </Animated.View>
          <Animated.View style={[styles.photoWrap, { opacity: photoOpacity, transform: [{ translateY: photoY }, { scale: photoScale }] }]}>
            {piece.imageUrl
              ? <CachedImage source={{ uri: piece.imageUrl }} style={styles.photo} accessibilityLabel={piece.name} />
              : <View style={[styles.photo, styles.photoBlank]} />}
          </Animated.View>
        </View>
        <Animated.View style={[styles.content, { opacity: contentOpacity }]} pointerEvents={done ? 'auto' : 'none'}>
          <Text style={styles.label}>Delivered</Text>
          <Text style={styles.name} numberOfLines={2}>{piece.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[pieceCaption(piece), more > 0 ? `+${more} more` : null].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.actions}>
            <Button label="Post your fit" fullWidth onPress={postFit} testID="unboxing-post-fit" />
            <Button label="Not now" variant="tertiary" fullWidth onPress={onClose} testID="unboxing-not-now" />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const PHOTO_W = 232;

const styles = StyleSheet.create({
  // outlineStyle: no web focus ring on the full-screen tap-to-skip area.
  root: { flex: 1, backgroundColor: INK, paddingHorizontal: SP.lg, outlineStyle: 'none' } as object,
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  box: { position: 'absolute', alignItems: 'center' },
  lid: { width: 152, height: 26, borderWidth: 1.5, borderColor: SILVER, backgroundColor: INK, marginBottom: 4 },
  body: { width: 136, height: 104, borderWidth: 1.5, borderColor: SILVER, backgroundColor: INK },
  photoWrap: { width: PHOTO_W, height: PHOTO_W * 1.25 },
  photo: { width: PHOTO_W, height: PHOTO_W * 1.25, backgroundColor: '#111114' },
  photoBlank: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#2C2C30' },
  content: { alignItems: 'center', gap: 4 },
  label: { fontFamily: FONT.medium, fontSize: FS.meta, color: SILVER, letterSpacing: 0.6, textTransform: 'uppercase' },
  name: { fontFamily: FONT.bold, fontSize: FS.xl, color: PAPER, textAlign: 'center' },
  meta: { fontFamily: FONT.regular, fontSize: FS.sm, color: SILVER },
  actions: { alignSelf: 'stretch', gap: SP.xs, marginTop: SP.lg },
});

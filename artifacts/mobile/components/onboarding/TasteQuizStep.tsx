/**
 * Buyer onboarding — swipe taste quiz (the step after the style picker).
 *
 * Copied from Tinder's card stack: one big photo card, the next one waiting
 * underneath, X / heart buttons below, and a "Learning your style · N left"
 * pill on top (Tinder's "Learning your type"). Right = like, left = pass.
 * 12–15 real, active products come from GET /api/buyer/taste-quiz; when the
 * catalog can't fill 12 the step skips itself. It ends on a style identity
 * card ("Your style / Archive Minimal") the buyer can share or skip.
 *
 * Motion: the card follows the finger and flies off on release. Under Reduce
 * Motion it fades instead. One light haptic per committed swipe, none while
 * dragging.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { hapticLight } from '@/lib/haptics';
import { QUIZ_MIN_PRODUCTS, styleIdentity, type QuizProduct, type QuizSwipe, type StyleIdentity } from '@/lib/tasteQuiz';
import { PillButton, PressableScale } from './OnboardingUI';
import { SPACE, useOnboardingMotion } from './onboardingTokens';

export interface TasteQuizResult {
  swipes: QuizSwipe[];
  identity: StyleIdentity | null;
}

interface Props {
  /** Called once: with the swipes when finished, or with none when skipped / unavailable. */
  onDone: (result: TasteQuizResult) => void;
}

const SWIPE_OUT = 120;

type Phase = 'loading' | 'quiz' | 'result';

export function TasteQuizStep({ onDone }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const api = useApi();
  const { reduceMotion } = useOnboardingMotion();

  const [phase, setPhase] = useState<Phase>('loading');
  const [products, setProducts] = useState<QuizProduct[]>([]);
  const [index, setIndex] = useState(0);
  const [swipes, setSwipes] = useState<QuizSwipe[]>([]);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((result: TasteQuizResult) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current(result);
  }, []);

  useEffect(() => {
    let alive = true;
    api.buyer.tasteQuiz.products()
      .then(({ products: list }) => {
        if (!alive) return;
        if (list.length < QUIZ_MIN_PRODUCTS) { finish({ swipes: [], identity: null }); return; }
        setProducts(list);
        setPhase('quiz');
        // Warm the next photos so cards never appear blank.
        void Image.prefetch(list.slice(0, 4).map((p) => p.imageUrl)).catch(() => {});
      })
      .catch(() => { if (alive) finish({ swipes: [], identity: null }); });
    return () => { alive = false; };
  }, [api, finish]);

  const liked = useMemo(() => {
    const likedIds = new Set(swipes.filter((s) => s.liked).map((s) => s.productId));
    return products.filter((p) => likedIds.has(p.id));
  }, [products, swipes]);
  const identity = useMemo(() => styleIdentity(liked), [liked]);

  // ── Card motion ──────────────────────────────────────────────────────────
  const pan = useRef(new Animated.ValueXY()).current;
  const fade = useRef(new Animated.Value(1)).current;
  const busy = useRef(false);

  const commit = useCallback((likedIt: boolean) => {
    const product = products[index];
    if (!product || busy.current) return;
    busy.current = true;
    hapticLight();
    const advance = () => {
      const next = [...swipes, { productId: product.id, liked: likedIt }];
      setSwipes(next);
      pan.setValue({ x: 0, y: 0 });
      fade.setValue(1);
      busy.current = false;
      const nextIndex = index + 1;
      void Image.prefetch(products.slice(nextIndex + 1, nextIndex + 3).map((p) => p.imageUrl)).catch(() => {});
      if (nextIndex >= products.length) {
        const result = { swipes: next, identity: styleIdentity(products.filter((p) => next.some((s) => s.liked && s.productId === p.id))) };
        if (result.identity) setPhase('result'); else finish(result);
      }
      setIndex(nextIndex);
    };
    if (reduceMotion) {
      Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: Platform.OS !== 'web' }).start(advance);
      return;
    }
    const width = area.width || 400;
    Animated.timing(pan, {
      toValue: { x: (likedIt ? 1 : -1) * width * 1.4, y: 40 },
      duration: 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start(advance);
  }, [area.width, fade, finish, index, pan, products, reduceMotion, swipes]);

  const commitRef = useRef(commit);
  commitRef.current = commit;

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => { if (!busy.current) pan.setValue({ x: g.dx, y: g.dy * 0.2 }); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > SWIPE_OUT) commitRef.current(true);
      else if (g.dx < -SWIPE_OUT) commitRef.current(false);
      else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: Platform.OS !== 'web', friction: 7 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: Platform.OS !== 'web' }).start();
    },
  }), [pan]);

  const rotate = pan.x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-10deg', '0deg', '10deg'] });
  const likeOpacity = pan.x.interpolate({ inputRange: [0, SWIPE_OUT], outputRange: [0, 1], extrapolate: 'clamp' });
  const passOpacity = pan.x.interpolate({ inputRange: [-SWIPE_OUT, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  const onArea = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };
  // 4:5 photo plus a caption row, never taller than the space we have.
  const cardWidth = Math.min(area.width, Math.max(0, (area.height - CAPTION_H) * 0.8));
  const photoHeight = cardWidth * 1.25;

  async function share() {
    if (!identity) return;
    try {
      await Share.share({ message: `My style on Brandthread: ${identity.title}` });
    } catch {
      // dismissed
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={styles.center} testID="taste-quiz-loading">
        <ActivityIndicator color={theme.muted} />
      </View>
    );
  }

  if (phase === 'result' && identity) {
    const thumbs = liked.slice(0, 3);
    return (
      <View style={styles.resultWrap} testID="taste-quiz-result">
        <View style={styles.identityCard}>
          <Text style={styles.identityLabel}>Your style</Text>
          <Text style={styles.identityTitle} accessibilityRole="header">{identity.title}</Text>
          <View style={styles.thumbRow}>
            {thumbs.map((p) => (
              <Image key={p.id} source={{ uri: p.imageUrl }} style={styles.thumb} contentFit="cover" accessibilityLabel={p.name} />
            ))}
          </View>
        </View>
        <View style={styles.resultActions}>
          <PillButton
            label="Continue"
            testID="taste-quiz-continue"
            onPress={() => finish({ swipes, identity })}
          />
          <PillButton
            label="Share"
            variant="secondary"
            haptic={false}
            testID="taste-quiz-share"
            onPress={share}
          />
        </View>
      </View>
    );
  }

  const current = products[index];
  const next = products[index + 1];
  const left = products.length - index;

  return (
    <View style={styles.wrap} testID="taste-quiz">
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <Text style={styles.pillTitle}>Learning your style</Text>
          <Text style={styles.pillSub}>{left} left</Text>
        </View>
        <PressableScale
          testID="taste-quiz-skip"
          accessibilityRole="button"
          accessibilityLabel="Skip the style quiz"
          onPress={() => finish({ swipes, identity: null })}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.skip}>Skip</Text>
        </PressableScale>
      </View>

      <View style={styles.stackArea} onLayout={onArea}>
        {cardWidth > 0 && next && (
          <View style={[styles.card, styles.cardBehind, { width: cardWidth }]} pointerEvents="none">
            <Image source={{ uri: next.imageUrl }} style={{ width: cardWidth, height: photoHeight }} contentFit="cover" />
            <Caption product={next} styles={styles} />
          </View>
        )}
        {cardWidth > 0 && current && (
          <Animated.View
            key={current.id}
            {...responder.panHandlers}
            testID={`taste-quiz-card-${index}`}
            accessibilityLabel={`${current.brand ? `${current.brand}, ` : ''}${current.name}`}
            style={[
              styles.card,
              { width: cardWidth, opacity: fade, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
            ]}
          >
            <Image source={{ uri: current.imageUrl }} style={{ width: cardWidth, height: photoHeight }} contentFit="cover" />
            <Animated.View style={[styles.stamp, styles.stampLike, { opacity: likeOpacity }]} pointerEvents="none">
              <Text style={styles.stampText}>LIKE</Text>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampPass, { opacity: passOpacity }]} pointerEvents="none">
              <Text style={styles.stampText}>PASS</Text>
            </Animated.View>
            <Caption product={current} styles={styles} />
          </Animated.View>
        )}
      </View>

      <View style={styles.buttons}>
        <PressableScale
          testID="taste-quiz-pass"
          accessibilityRole="button"
          accessibilityLabel="Pass"
          style={styles.roundBtn}
          onPress={() => commit(false)}
        >
          <Feather name="x" size={28} color={theme.text} />
        </PressableScale>
        <PressableScale
          testID="taste-quiz-like"
          accessibilityRole="button"
          accessibilityLabel="Like"
          style={[styles.roundBtn, styles.roundBtnSolid]}
          onPress={() => commit(true)}
        >
          <Feather name="heart" size={26} color={theme.background} />
        </PressableScale>
      </View>
    </View>
  );
}

const CAPTION_H = 56;

function Caption({ product, styles }: { product: QuizProduct; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.caption}>
      {!!product.brand && <Text style={styles.brand} numberOfLines={1}>{product.brand}</Text>}
      <Text style={styles.productName} numberOfLines={1}>{product.name}</Text>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { flex: 1, paddingBottom: SPACE.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.md },
  pill: {
    paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: 12,
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  pillTitle: { fontSize: 13, fontWeight: '600', color: theme.text },
  pillSub: { fontSize: 12, color: theme.muted, marginTop: 1, fontVariant: ['tabular-nums'] },
  skip: { fontSize: 15, fontWeight: '600', color: theme.muted },
  stackArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute', borderRadius: 16, overflow: 'hidden',
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  cardBehind: { transform: [{ scale: 0.95 }], opacity: 0.6 },
  caption: { height: CAPTION_H, paddingHorizontal: SPACE.md, justifyContent: 'center' },
  brand: { fontSize: 12, color: theme.muted, fontWeight: '500' },
  productName: { fontSize: 15, color: theme.text, fontWeight: '600', marginTop: 2 },
  stamp: {
    position: 'absolute', top: SPACE.lg, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xxs,
    borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  stampLike: { left: SPACE.lg, transform: [{ rotate: '-12deg' }] },
  stampPass: { right: SPACE.lg, transform: [{ rotate: '12deg' }] },
  stampText: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: SPACE.xl, marginTop: SPACE.md },
  roundBtn: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background,
  },
  roundBtnSolid: { backgroundColor: theme.text, borderColor: theme.text },
  resultWrap: { flex: 1, justifyContent: 'space-between', paddingTop: SPACE.xl, paddingBottom: SPACE.lg },
  identityCard: {
    borderRadius: 20, padding: SPACE.lg, backgroundColor: theme.card,
    borderWidth: 1, borderColor: theme.border,
  },
  identityLabel: { fontSize: 13, fontWeight: '600', color: theme.muted, textTransform: 'uppercase', letterSpacing: 1.2 },
  identityTitle: { fontSize: 40, lineHeight: 44, fontWeight: '700', color: theme.text, marginTop: SPACE.xs, letterSpacing: -1 },
  thumbRow: { flexDirection: 'row', gap: SPACE.xs, marginTop: SPACE.lg },
  thumb: { flex: 1, aspectRatio: 0.8, borderRadius: 10, backgroundColor: theme.surface },
  resultActions: { gap: SPACE.sm },
});

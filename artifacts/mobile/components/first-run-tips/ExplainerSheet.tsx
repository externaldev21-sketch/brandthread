import { hexToRgba as mediaAlpha } from '@/lib/backgroundPalette';
import { MEDIA } from '@/lib/theme';
/**
 * `explainer` variant — the one-time "what is this screen" sheet. A card
 * pinned to the bottom of the screen: the screen's name and an X, then a
 * small swipeable carousel of 2–3 mini-cards (one idea each: icon, short
 * title, one line) with the dashboard tour's "1 / 3" count and dots. Swipe
 * or tap a card (or Next) to advance; Got it on the last card. The X or a
 * tap anywhere outside the sheet bails from any card.
 *
 * Same card language as the anchored variant (solid elevated fill, hairline
 * border, white pill button) so every first-run surface reads as one
 * system. Rendered in a transparent Modal so it sits above the tab bars and
 * headers instead of being clipped by the screen it explains.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FILL_ELEVATED, FONT, FS, SP, RADIUS, TEXT_SECONDARY, TEXT_TERTIARY } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useRegisterCoach } from '@/lib/coachPresence';

export interface ExplainerStep {
  icon: IconName;
  title: string;
  body: string;
}

export interface ExplainerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** The screen's name, as the screen itself titles it. */
  title: string;
  /** 2–3 mini-cards, one idea each. */
  steps: ExplainerStep[];
  reduceMotion?: boolean;
  testID?: string;
}

export function ExplainerSheet({ visible, onDismiss, title, steps, reduceMotion = false, testID }: ExplainerSheetProps) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const pager = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [index, setIndex] = useState(0);
  // The cookie-consent card waits while this is up.
  useRegisterCoach(testID ?? 'first-run-tip-explainer', visible);

  useEffect(() => {
    if (!visible) { rise.setValue(0); setIndex(0); return; }
    Animated.timing(rise, { toValue: 1, duration: reduceMotion ? 1 : 220, useNativeDriver: true }).start();
  }, [visible, rise, reduceMotion]);

  if (!visible || steps.length === 0) return null;

  const isLast = index === steps.length - 1;

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(steps.length - 1, next));
    setIndex(clamped);
    pager.current?.scrollTo({ x: clamped * pageWidth, animated: !reduceMotion });
  }

  function advance() {
    if (isLast) onDismiss();
    else goTo(index + 1);
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!pageWidth) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (next !== index && next >= 0 && next < steps.length) setIndex(next);
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onDismiss} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: rise }]} testID={testID ?? 'first-run-tip-explainer'}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.cardWrap,
            { paddingBottom: Math.max(insets.bottom, SP.md) },
            { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
          ]}
        >
          <View style={styles.card} accessibilityViewIsModal>
            <View style={styles.headerRow}>
              <Text style={styles.title} accessibilityRole="header">{title}</Text>
              <Pressable
                onPress={onDismiss}
                hitSlop={12}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID="first-run-tip-explainer-close"
              >
                <Icon name="x" size={18} color={mediaAlpha(MEDIA.foreground, 0.7)} />
              </Pressable>
            </View>

            <View onLayout={(e: LayoutChangeEvent) => setPageWidth(e.nativeEvent.layout.width)}>
              <ScrollView
                ref={pager}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={onScroll}
                scrollEventThrottle={16}
                testID="first-run-tip-explainer-pager"
              >
                {steps.map((step, i) => (
                  <Pressable
                    key={i}
                    onPress={advance}
                    style={[styles.page, pageWidth ? { width: pageWidth } : null]}
                    accessibilityRole="button"
                    accessibilityLabel={`${step.title}. ${step.body}`}
                    accessibilityHint={i === steps.length - 1 ? 'Closes the tip' : 'Shows the next tip'}
                    testID={`first-run-tip-explainer-step-${i}`}
                  >
                    <View style={styles.miniCard}>
                      <View style={styles.iconWell}>
                        <Icon name={step.icon} size={20} color={MEDIA.foreground} />
                      </View>
                      <View style={styles.miniText}>
                        <Text style={styles.stepTitle}>{step.title}</Text>
                        <Text style={styles.stepBody}>{step.body}</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={styles.footerRow}>
              <View style={styles.dots} testID="first-run-tip-explainer-dots">
                {steps.map((_, i) => (
                  <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
              <Text style={styles.stepCount} testID="first-run-tip-explainer-count">{index + 1} / {steps.length}</Text>
            </View>

            <PressableScale
              onPress={advance}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Got it' : 'Next'}
              testID={isLast ? 'first-run-tip-explainer-ok' : 'first-run-tip-explainer-next'}
            >
              <Text style={styles.buttonText}>{isLast ? 'Got it' : 'Next'}</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: mediaAlpha(MEDIA.background, 0.6) },
  cardWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: FILL_ELEVATED, // solid: content never shows through a tip
    borderWidth: 1, borderColor: mediaAlpha(MEDIA.foreground, 0.14),
    borderRadius: RADIUS.lg,
    padding: SP.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  title: { flex: 1, color: MEDIA.foreground, fontFamily: FONT.bold, fontSize: FS.lg },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginLeft: SP.sm },
  page: { width: '100%' },
  // Tall enough for a title and a three-line body, so every card (and the
  // sheet) is the same size whichever card is showing.
  miniCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    minHeight: 118,
    padding: SP.md,
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: mediaAlpha(MEDIA.foreground, 0.1),
    backgroundColor: mediaAlpha(MEDIA.foreground, 0.04),
  },
  iconWell: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: mediaAlpha(MEDIA.foreground, 0.08),
  },
  miniText: { flex: 1 },
  stepTitle: { color: MEDIA.foreground, fontFamily: FONT.semibold, fontSize: FS.base },
  stepBody: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginTop: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 14 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: mediaAlpha(MEDIA.foreground, 0.3) },
  dotActive: { backgroundColor: MEDIA.foreground, width: 14 },
  stepCount: { fontVariant: ['tabular-nums'], color: TEXT_TERTIARY, fontFamily: FONT.medium, fontSize: FS.xs },
  button: { backgroundColor: MEDIA.foreground, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: MEDIA.background, fontFamily: FONT.bold, fontSize: FS.sm },
});

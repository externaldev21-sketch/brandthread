import { hexToRgba as mediaAlpha } from '@/lib/backgroundPalette';
import { MEDIA } from '@/lib/theme';
/**
 * `explainer` variant — the one-time "what is this screen" sheet. A short
 * card pinned to the bottom of the screen: the screen's name, 2–4 plain
 * lines on what it is and what to do there, and one Got it button. Got it,
 * the X, or a tap anywhere outside the card all dismiss it.
 *
 * Same card language as the anchored variant (solid elevated fill, hairline
 * border, white pill button) so every first-run surface reads as one
 * system. Rendered in a transparent Modal so it sits above the tab bars and
 * headers instead of being clipped by the screen it explains.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FILL_ELEVATED, FONT, FS, SP, RADIUS, TEXT_SECONDARY } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { Icon } from '@/components/ui/Icon';
import { useRegisterCoach } from '@/lib/coachPresence';

export interface ExplainerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** The screen's name, as the screen itself titles it. */
  title: string;
  /** 2–4 short lines: what the screen is, then the main things to do there. */
  lines: string[];
  reduceMotion?: boolean;
  testID?: string;
}

export function ExplainerSheet({ visible, onDismiss, title, lines, reduceMotion = false, testID }: ExplainerSheetProps) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  // The cookie-consent card waits while this is up.
  useRegisterCoach(testID ?? 'first-run-tip-explainer', visible);

  useEffect(() => {
    if (!visible) { rise.setValue(0); return; }
    Animated.timing(rise, { toValue: 1, duration: reduceMotion ? 1 : 220, useNativeDriver: true }).start();
  }, [visible, rise, reduceMotion]);

  if (!visible) return null;

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
            {lines.map((line, i) => (
              <View key={i} style={styles.lineRow}>
                <View style={styles.bullet} />
                <Text style={[styles.line, i === 0 && styles.lead]}>{line}</Text>
              </View>
            ))}
            <PressableScale
              onPress={onDismiss}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel="Got it"
              testID="first-run-tip-explainer-ok"
            >
              <Text style={styles.buttonText}>Got it</Text>
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
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 8, backgroundColor: TEXT_SECONDARY },
  line: { flex: 1, color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  lead: { color: MEDIA.foreground, fontFamily: FONT.medium },
  button: { backgroundColor: MEDIA.foreground, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', marginTop: SP.sm },
  buttonText: { color: MEDIA.background, fontFamily: FONT.bold, fontSize: FS.sm },
});

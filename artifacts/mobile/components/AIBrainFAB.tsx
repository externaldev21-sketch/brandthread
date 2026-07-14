/**
 * Brandthread AI Brain — Floating Action Button
 *
 * A subtle floating entry point placed on all key Seller screens.
 * - Uses the official Brandthread logo
 * - Hides when keyboard is open
 * - Respects safe area insets
 * - Never covers important controls (bottom-right, above tab bar if present)
 * - Passes typed screen context to the AI Brain screen
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated, Keyboard, Platform, Pressable, StyleSheet, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { AIScreenContext } from '@/services/aiTypes';
import * as Haptics from 'expo-haptics';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AIBrainFABProps {
  context: AIScreenContext;
  /**
   * Additional bottom offset — use when tab bar is present.
   * Default: 0 (the component already respects safeArea.bottom).
   */
  bottomOffset?: number;
  /** Hides the FAB completely — useful when local overlay is open */
  hidden?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIBrainFAB({ context, bottomOffset = 0, hidden = false }: AIBrainFABProps) {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(hidden ? 0 : 1)).current;
  const scale   = useRef(new Animated.Value(hidden ? 0 : 1)).current;

  // Hide with keyboard
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', _hide);
    const hide  = Keyboard.addListener('keyboardWillHide', _show);
    const showA = Keyboard.addListener('keyboardDidShow', _hide);
    const hideA = Keyboard.addListener('keyboardDidHide', _show);
    return () => { show.remove(); hide.remove(); showA.remove(); hideA.remove(); };
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(opacity, { toValue: hidden ? 0 : 1, useNativeDriver: true, speed: 20 }),
      Animated.spring(scale,   { toValue: hidden ? 0 : 1, useNativeDriver: true, speed: 20 }),
    ]).start();
  }, [hidden]);

  function _hide() {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(scale,   { toValue: 0.8, duration: 150, useNativeDriver: true }),
    ]).start();
  }

  function _show() {
    if (hidden) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1, useNativeDriver: true, speed: 20 }),
    ]).start();
  }

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push({
      pathname: '/ai-brain',
      params: { context: JSON.stringify(context) },
    });
  }

  const bottom = 16 + insets.bottom + bottomOffset;

  return (
    <Animated.View
      style={[styles.container, { bottom, opacity, transform: [{ scale }] }]}
      pointerEvents={hidden ? 'none' : 'box-none'}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        accessibilityLabel="Open Brandthread AI"
        accessibilityRole="button"
      >
        {/* Glow ring */}
        <View style={styles.glow} />
        {/* Gradient pill */}
        <LinearGradient
          colors={['#8B5CF6', '#6D28D9']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <BrandthreadLogo size={22} opacity={1} />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SIZE = 52;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    zIndex: 9999,
    elevation: 10,
  },
  pressable: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.93 }],
  },
  glow: {
    position: 'absolute',
    width: SIZE + 16,
    height: SIZE + 16,
    borderRadius: (SIZE + 16) / 2,
    backgroundColor: 'rgba(139,92,246,0.20)',
    top: -8,
    left: -8,
  },
  gradient: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
});

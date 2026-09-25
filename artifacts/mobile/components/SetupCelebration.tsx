/**
 * SetupCelebration — small one-time celebration shown the moment a seller
 * finishes all required guided-setup steps. No external confetti library;
 * a themed animated badge keeps this lightweight and consistent across
 * all 12 themes.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

export default function SetupCelebration({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const { theme } = useAppTheme();
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    scale.setValue(0.6);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              opacity,
              transform: [{ scale }],
            },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <Feather name="check" size={ICON.lg} color={theme.onAccent} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Your store is ready!</Text>
          <Text style={[styles.body, { color: theme.muted }]}>
            You've completed every required setup step. Time to start selling.
          </Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.accent }]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: theme.onAccent }]}>Let's go</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  card: {
    width: '100%', maxWidth: 340, borderRadius: RADIUS.xl, borderWidth: 1,
    paddingVertical: SP.xl, paddingHorizontal: SP.lg, alignItems: 'center', gap: SP.xs,
  },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  title: { fontSize: FS.lg, fontFamily: FONT.bold, textAlign: 'center' },
  body: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 20, marginBottom: SP.sm },
  btn: { width: '100%', height: 48, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: FS.base, fontFamily: FONT.bold },
});

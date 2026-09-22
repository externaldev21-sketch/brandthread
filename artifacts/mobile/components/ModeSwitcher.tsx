import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';

type Mode = 'buyer' | 'seller';

interface ModeSwitcherProps {
  currentMode: Mode;
}

export default function ModeSwitcher({ currentMode }: ModeSwitcherProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const [isBoth, setIsBoth] = useState(false);
  const slideAnim = React.useRef(new Animated.Value(currentMode === 'seller' ? 1 : 0)).current;

  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => setIsBoth(r === 'both'));
  }, []);

  if (!isBoth) return null;

  const switchTo = async (mode: Mode) => {
    if (mode === currentMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem('active_mode', mode);
    Animated.spring(slideAnim, {
      toValue: mode === 'seller' ? 1 : 0,
      damping: 20,
      stiffness: 200,
      useNativeDriver: true,
    }).start();
    setTimeout(() => {
      router.replace((mode === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
    }, 150);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        {/* Sliding indicator */}
        <Animated.View
          style={[
            styles.indicator,
            {
              transform: [{
                translateX: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 88],
                }),
              }],
            },
          ]}
        />
        <TouchableOpacity style={styles.option} onPress={() => switchTo('buyer')} activeOpacity={0.8}>
          <Text style={[styles.optionText, currentMode === 'buyer' && styles.optionTextActive]}>
            🛍️  Shopping
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.option} onPress={() => switchTo('seller')} activeOpacity={0.8}>
          <Text style={[styles.optionText, currentMode === 'seller' && styles.optionTextActive]}>
            🏷️  My Brand
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: theme.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  track: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 100,
    padding: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 88,
    height: 30,
    borderRadius: 100,
    backgroundColor: theme.accent,
  },
  option: {
    width: 88,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  optionText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: theme.muted,
  },
  optionTextActive: {
    color: theme.onAccent,
  },
});

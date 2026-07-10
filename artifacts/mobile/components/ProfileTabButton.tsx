import React, { useRef } from 'react';
import { GestureResponderEvent, Pressable, StyleProp, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useRole } from '@/contexts/RoleContext';

const DOUBLE_TAP_WINDOW_MS = 350;

interface ProfileTabButtonProps {
  otherSidePath: '/(buyer)/profile' | '/(tabs)/profile';
  onPress?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  [key: string]: any;
}

/**
 * Profile tab button that supports double-tap to jump to the other side's
 * profile (buyer <-> seller) for accounts with role === 'both'. Single taps
 * behave like the normal tab button.
 */
export function ProfileTabButton({ otherSidePath, onPress, style, ...rest }: ProfileTabButtonProps) {
  const { role } = useRole();
  const router = useRouter();
  const lastTap = useRef(0);

  function handlePress(e: GestureResponderEvent) {
    const now = Date.now();
    const isDoubleTap = now - lastTap.current < DOUBLE_TAP_WINDOW_MS;
    lastTap.current = now;

    if (isDoubleTap && role === 'both') {
      lastTap.current = 0;
      router.replace(otherSidePath as never);
      return;
    }

    onPress?.(e);
  }

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      style={[style, { alignItems: 'center', justifyContent: 'center' }]}
    />
  );
}

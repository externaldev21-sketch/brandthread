import React, { useRef } from 'react';
import { GestureResponderEvent, Platform, Pressable, StyleProp, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useRole } from '@/contexts/RoleContext';

const DOUBLE_TAP_WINDOW_MS = 350;

// The tab navigator passes an `href` prop on web for link-based navigation.
// We need to strip it from the Pressable props and handle routing manually so
// the button works on both native and web.
interface ProfileTabButtonProps {
  otherSidePath: '/(buyer)/profile' | '/(tabs)/profile';
  onPress?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  href?: string;
  [key: string]: any;
}

/**
 * Profile tab button that supports double-tap to jump to the other side's
 * profile (buyer <-> seller) for accounts with role === 'both'. Single taps
 * navigate to the profile screen.
 */
export function ProfileTabButton({ otherSidePath, onPress, style, href, ...rest }: ProfileTabButtonProps) {
  const { role } = useRole();
  const router = useRouter();
  const lastTap = useRef(0);

  // Derive own profile path from otherSidePath
  const ownPath = otherSidePath === '/(buyer)/profile' ? '/(tabs)/profile' : '/(buyer)/profile';

  function handlePress(e: GestureResponderEvent) {
    const now = Date.now();
    const isDoubleTap = now - lastTap.current < DOUBLE_TAP_WINDOW_MS;
    lastTap.current = now;

    // Double-tap profile switching was only for 'both' accounts which no longer exist.
    void isDoubleTap;

    if (Platform.OS === 'web') {
      router.push(ownPath as never);
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

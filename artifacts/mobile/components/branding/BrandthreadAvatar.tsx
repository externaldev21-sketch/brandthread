/**
 * The official @brandthread account's profile picture: the B logo filling a
 * seamless circle (no border, ring or padding) — used wherever that account
 * appears as an avatar (inbox row, chat header, chat messages, details).
 */
import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import { BRANDTHREAD_AVATAR_SOURCE, LOGO_A11Y_LABEL } from '@/constants/branding';

export function BrandthreadAvatar({ size, style, testID = 'brandthread-avatar' }: {
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={LOGO_A11Y_LABEL}
      style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }, style]}
    >
      <Image source={BRANDTHREAD_AVATAR_SOURCE} style={{ width: size, height: size }} resizeMode="cover" />
    </View>
  );
}

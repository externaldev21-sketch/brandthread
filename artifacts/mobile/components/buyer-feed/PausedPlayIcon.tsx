/**
 * Centre icon shown while a feed video is paused — TikTok's paused state
 * (Mobbin "Watching" flow): a semi-transparent white play triangle with
 * rounded corners and a soft shadow, no disc behind it. The rounding comes
 * from stroking the triangle in its own colour with round joins, so there
 * are no sharp points at any size.
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

export const PAUSED_ICON_SIZE = 60;

export function PausedPlayIcon({ size = PAUSED_ICON_SIZE }: { size?: number }) {
  return (
    <View style={[styles.shadow, { width: size, height: size }]} accessibilityLabel="Paused" accessibilityRole="image">
      <Svg width={size} height={size} viewBox="0 0 60 60">
        {/* Opacity on the group, so fill and stroke don't double up. */}
        <G opacity={0.8}>
          <Path
            d="M21 14.5 L46 30 L21 45.5 Z"
            fill="#FFFFFF"
            stroke="#FFFFFF"
            strokeWidth={8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: Platform.select({
    web: { filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.35))' } as object,
    default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 8 },
  }) as object,
});

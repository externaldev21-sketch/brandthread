import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { crispPx } from '@/lib/crispPixel';
import { haptics } from '@/lib/haptics';
import { useSellerUnreadThreads } from '@/hooks/useSellerUnreadThreads';

/**
 * One tap from the dashboard to the seller inbox — Instagram's DM icon
 * pattern, so the screen a seller opens many times a day isn't behind the
 * More tab. Badge = buyer threads with anything unread (same badge styling as
 * ActivityBellButton beside it).
 */
export default function SellerMessagesButton({
  color,
  size = 22,
  style,
  badgeBorderColor,
  testID = 'seller-messages-button',
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  badgeBorderColor?: string;
  testID?: string;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const unread = useSellerUnreadThreads();

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.button, style]}
      activeOpacity={0.7}
      hitSlop={4}
      onPress={() => {
        haptics.light();
        router.push('/seller-inbox' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
    >
      <View>
        <Icon name="message-circle" size={size} color={color ?? theme.text} />
        {unread > 0 && (
          <View
            testID={`${testID}-badge`}
            style={[styles.badge, { backgroundColor: theme.accent, borderColor: badgeBorderColor ?? theme.background }]}
          >
            <Text style={[styles.badgeText, { color: theme.onAccent }]} allowFontScaling={false}>
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -7,
    left: '55%',
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: crispPx(1.5),
  },
  badgeText: { fontSize: FS.xs, lineHeight: 12, fontFamily: FONT.bold },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { getUnreadActivityCount, subscribeActivity, subscribeUnreadOverride, watchActivityRealtime } from '@/services/activityService';
import { Icon } from '@/components/ui/Icon';
import { crispPx } from '@/lib/crispPixel';
import Animated from 'react-native-reanimated';
import { useBadgeSpring } from '@/components/motion/BadgeSpring';

/**
 * Unread Activity Center count. Refreshes when the host screen gains focus,
 * (debounced) whenever activity is read or dismissed anywhere in the app, and
 * live via watchActivityRealtime while this button is mounted: the realtime
 * sockets trigger an immediate fetch, and a ~1.5s short poll runs only while
 * those sockets are down (see watchActivityRealtime's own comment).
 */
export function useActivityUnreadCount(): number {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    void getUnreadActivityCount().then((next) => {
      if (mounted.current) setCount(next);
    });
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeActivity(() => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refresh, 400);
    });
    // "Mark all read" zeroes the badge immediately (see markAllActivityRead).
    const unsubscribeOverride = subscribeUnreadOverride((next) => {
      if (mounted.current) setCount(next);
    });
    const realtime = watchActivityRealtime(({ count: next }) => {
      if (mounted.current) setCount(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      unsubscribeOverride();
      realtime.stop();
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [refresh]);

  return count;
}

/**
 * Header bell that opens the Activity Center, with an unread count badge.
 * `color` is the glyph colour (pass the host header's icon colour so it sits
 * naturally next to sibling icons); `size`/`style` match the host's icon
 * buttons.
 */
export default function ActivityBellButton({
  color,
  size = 20,
  style,
  badgeBorderColor,
  testID = 'activity-bell',
}: {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Ring around the badge; defaults to the theme background. */
  badgeBorderColor?: string;
  testID?: string;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const unread = useActivityUnreadCount();
  const label = unread > 0
    ? `Activity, ${unread} unread`
    : 'Activity';

  // Badge springs in/out (pack 2, item 26).
  const badgeSpring = useBadgeSpring(unread);
  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.button, style]}
      activeOpacity={0.7}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      onPress={() => {
        router.push('/activity-center' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* The badge is anchored to the glyph, so it sits correctly whatever
          hit-area size the host header gives the button. */}
      <View>
        <Icon name="bell" size={size} color={color ?? theme.text} />
        {badgeSpring.visible && (
          <Animated.View
            style={[
              styles.badge,
              { backgroundColor: theme.accent, borderColor: badgeBorderColor ?? theme.background },
              badgeSpring.style,
            ]}
          >
            <Text style={[styles.badgeText, { color: theme.onAccent }]} allowFontScaling={false}>
              {badgeSpring.shown > 99 ? '99+' : badgeSpring.shown}
            </Text>
          </Animated.View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  badgeText: {
    fontSize: FS.xs,
    lineHeight: 12,
    fontFamily: FONT.bold,
  },
});

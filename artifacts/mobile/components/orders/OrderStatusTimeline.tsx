import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import type { OrderStatus } from '@/services/orderTypes';

/**
 * Live horizontal status tracker used on both the seller and buyer order
 * detail screens (and inline, compact, on order cards). Single source of
 * truth for "how far along is this order" so the two screens never disagree
 * on stage order or terminal-state handling.
 */

const HAPPY_PATH: OrderStatus[] = ['new', 'processing', 'ready_to_ship', 'shipped', 'delivered'];

const STAGE_LABEL: Record<OrderStatus, string> = {
  new: 'Placed',
  processing: 'Processing',
  ready_to_ship: 'Ready',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

const STAGE_ICON: Record<OrderStatus, keyof typeof Feather.glyphMap> = {
  new: 'shopping-bag',
  processing: 'loader',
  ready_to_ship: 'package',
  shipped: 'truck',
  delivered: 'check-circle',
  cancelled: 'x-circle',
  refunded: 'rotate-ccw',
  disputed: 'alert-triangle',
};

export function OrderStatusTimeline({
  status,
  compact = false,
}: {
  status: OrderStatus;
  compact?: boolean;
}) {
  const { theme } = useAppTheme();
  const isTerminalException = status === 'cancelled' || status === 'refunded' || status === 'disputed';
  const pulse = useRef(new Animated.Value(0.5)).current;
  const activeIndex = HAPPY_PATH.indexOf(status);

  useEffect(() => {
    if (isTerminalException) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isTerminalException, pulse]);

  if (isTerminalException) {
    const c = status === 'refunded' ? theme.accent : theme.error;
    return (
      <View style={[styles.exceptionWrap, { backgroundColor: theme.surface, borderColor: c }]}>
        <Feather name={STAGE_ICON[status]} size={ICON.md} color={c} />
        <Text style={[styles.exceptionLabel, { color: c }]}>{STAGE_LABEL[status]}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {HAPPY_PATH.map((stage, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        const dotColor = done || active ? theme.accent : theme.border;
        return (
          <React.Fragment key={stage}>
            <View style={styles.stageCol}>
              <Animated.View
                style={[
                  styles.dot,
                  compact && styles.dotCompact,
                  {
                    backgroundColor: done ? theme.accent : theme.surface,
                    borderColor: dotColor,
                    opacity: active ? pulse : 1,
                  },
                ]}
              >
                {done ? <Feather name="check" size={compact ? 10 : 12} color={theme.onAccent} /> : null}
              </Animated.View>
              {!compact ? (
                <Text
                  numberOfLines={1}
                  style={[styles.stageLabel, { color: active || done ? theme.text : theme.muted }]}
                >
                  {STAGE_LABEL[stage]}
                </Text>
              ) : null}
            </View>
            {i < HAPPY_PATH.length - 1 ? (
              <View
                style={[
                  styles.connector,
                  compact && styles.connectorCompact,
                  { backgroundColor: i < activeIndex ? theme.accent : theme.border },
                ]}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: SP.sm },
  rowCompact: { paddingVertical: 0 },
  stageCol: { alignItems: 'center', width: 56 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCompact: { width: 10, height: 10, borderWidth: 1.5 },
  stageLabel: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.xs, textAlign: 'center' },
  connector: { flex: 1, height: 2, marginTop: 11, borderRadius: 1 },
  connectorCompact: { marginTop: 4, height: 1.5, minWidth: 8, flex: 0.5 },
  exceptionWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  exceptionLabel: { fontFamily: FONT.bold, fontSize: FS.sm },
});

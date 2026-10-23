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
 *
 * Compact (order cards) collapses to the three buyer-facing order events,
 * labelled Ordered / Shipped / Delivered: packing and ready-to-ship still
 * read as Ordered until the seller marks the order shipped.
 */

const HAPPY_PATH: OrderStatus[] = ['new', 'processing', 'ready_to_ship', 'shipped', 'delivered'];
const COMPACT_PATH: OrderStatus[] = ['new', 'shipped', 'delivered'];

const COMPACT_LABEL: Partial<Record<OrderStatus, string>> = {
  new: 'Ordered',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

/** Index of `status` on the compact Ordered → Shipped → Delivered path. */
export function compactStageIndex(status: OrderStatus): number {
  if (status === 'delivered') return 2;
  if (status === 'shipped') return 1;
  return 0;
}

const STAGE_LABEL: Record<OrderStatus, string> = {
  new: 'Placed',
  processing: 'Packing',
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
  const path = compact ? COMPACT_PATH : HAPPY_PATH;
  const activeIndex = compact ? compactStageIndex(status) : HAPPY_PATH.indexOf(status);

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
    <View
      style={[styles.row, compact && styles.rowCompact]}
      accessible={compact}
      accessibilityLabel={compact ? `Order progress: ${COMPACT_LABEL[path[activeIndex]]}` : undefined}
    >
      {path.map((stage, i) => {
        // The last stage is complete once reached (a delivered order has nothing left to pulse).
        const done = i < activeIndex || (i === activeIndex && i === path.length - 1);
        const active = i === activeIndex && !done;
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
              <Text
                style={[styles.stageLabel, compact && styles.stageLabelCompact, { color: active || done ? theme.text : theme.muted }]}
                numberOfLines={1}
              >
                {compact ? COMPACT_LABEL[stage] : STAGE_LABEL[stage]}
              </Text>
            </View>
            {i < path.length - 1 ? (
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
  stageCol: { alignItems: 'center', minWidth: 56 },
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
  connectorCompact: { marginTop: 4, height: 1.5, minWidth: 8, flex: 1 },
  stageLabelCompact: { fontSize: FS.xs, marginTop: 4 },
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

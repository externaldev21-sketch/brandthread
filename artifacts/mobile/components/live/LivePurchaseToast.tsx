/**
 * "<first name> bought <product>" — shown on the live when a purchase made
 * from it is paid (the server's `purchase` socket event, see
 * api-server lib/liveAttribution.ts). The host sees it on seller-live.tsx;
 * viewers see the same line as social proof on buyer-live.tsx. Purchases
 * queue and show one at a time, each for a few seconds.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, RADIUS } from '@/lib/theme';
import { purchaseLine } from '@/lib/live/liveAnalytics';
import type { LivePurchaseEvent } from '@/lib/live/useLiveSocket';

const SHOW_MS = 4000;

/** Queue of purchase toasts: `push` from the socket handler, render `current`. */
export function useLivePurchaseToasts(initial: LivePurchaseEvent[] = []) {
  const [queue, setQueue] = useState<LivePurchaseEvent[]>(initial);
  const seen = useRef(new Set<string>(initial.map((p) => p.id)));
  const push = useCallback((p: LivePurchaseEvent) => {
    if (seen.current.has(p.id)) return;
    seen.current.add(p.id);
    setQueue((prev) => [...prev, p].slice(-20));
  }, []);
  const current = queue[0] ?? null;
  const pinned = initial.length > 0;
  useEffect(() => {
    // `initial` (demo screenshots) stays on screen; live purchases rotate.
    if (!current || pinned) return undefined;
    const t = setTimeout(() => setQueue((prev) => prev.slice(1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [current, pinned]);
  return { current, push };
}

export function LivePurchaseToast({ purchase, top }: { purchase: LivePurchaseEvent | null; top: number }) {
  if (!purchase) return null;
  return (
    <View
      style={[styles.wrap, { top }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={purchaseLine(purchase)}
      testID="live-purchase-toast"
    >
      <View style={styles.icon}>
        <Feather name="shopping-bag" size={13} color="#FFFFFF" />
      </View>
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.name}>{purchase.buyerFirstName || 'Someone'}</Text>
        {' bought '}
        {purchase.units > 1 ? `${purchase.units} × ` : ''}
        {purchase.productName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 16, zIndex: 12, maxWidth: '72%',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: RADIUS.md,
    paddingLeft: 6, paddingRight: 12, paddingVertical: 6,
  },
  icon: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#000000',
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flexShrink: 1, color: '#000000', fontFamily: FONT.medium, fontSize: 13, lineHeight: 17 },
  name: { fontFamily: FONT.bold },
});

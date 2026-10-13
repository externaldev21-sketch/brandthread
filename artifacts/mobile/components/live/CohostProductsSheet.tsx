/**
 * Co-host side: pick which of your own products are in the host's live bag
 * (viewers buy them from your store). Same checklist pattern as the host's
 * "Tag products" picker in seller-live.tsx, in the shared BottomSheet.
 * Server: PUT /api/live/:id/cohost/products (accepted co-hosts only).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { fetchLiveBag, setCohostLiveProducts } from '@/services/liveShoppingService';

const MAX = 20;

export function CohostProductsSheet({ streamId, myId, visible, onClose }: {
  streamId: string; myId: string | undefined; visible: boolean; onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi() as any;
  const [products, setProducts] = useState<Array<{ id: string; name: string; priceCents: number }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.products.list().catch(() => null),
      fetchLiveBag(streamId).catch(() => []),
    ]).then(([mine, bag]) => {
      if (!alive) return;
      const list: any[] = Array.isArray(mine) ? mine : (mine?.products ?? []);
      setProducts(list.filter(p => p?.status === undefined || p.status === 'active').map(p => ({
        id: String(p.id), name: String(p.name ?? ''), priceCents: Number(p.priceCents ?? p.variants?.[0]?.priceCents ?? 0),
      })));
      setSelected(new Set(bag.filter(b => b.sellerId === myId).map(b => b.productId)));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, myId, streamId, visible]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX) next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await setCohostLiveProducts(streamId, [...selected]);
      onClose();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Could not update your products. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="cohost-products-sheet">
      <Text style={styles.title}>Your products in this live</Text>
      {loading ? <ActivityIndicator color={theme.muted} style={{ marginVertical: SP.lg }} /> : (
        <ScrollView style={{ maxHeight: 360 }}>
          {products.map(p => {
            const on = selected.has(p.id);
            return (
              <Pressable key={p.id} onPress={() => toggle(p.id)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.price}>{formatCents(p.priceCents)}</Text>
                </View>
                <View style={[styles.check, on && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                  {on ? <Feather name="check" size={13} color={theme.onAccent} /> : null}
                </View>
              </Pressable>
            );
          })}
          {products.length === 0 ? <Text style={styles.empty}>No products found</Text> : null}
        </ScrollView>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Save" onPress={() => void save()} loading={saving} fullWidth />
    </BottomSheet>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    title: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text, marginBottom: SP.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
    name: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    price: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
    empty: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, textAlign: 'center', paddingVertical: SP.lg },
    error: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, marginVertical: SP.xs },
  });
}

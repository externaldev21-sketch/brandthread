/**
 * One discount code's redemptions (GET /api/discount-codes/:id/uses): who
 * used it, when, and how much it took off. Opened from the uses pill on a
 * code in app/discounts.tsx.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';

interface Redemption {
  id: string;
  customerKey: string;
  customerName: string | null;
  appliedAmountCents: number;
  usedAt: string;
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function RedemptionsSheet({ code, onClose, previewOnly }: {
  /** The code to show; null hides the sheet. */
  code: { id: string; code: string } | null;
  onClose: () => void;
  /** Signed-out seller preview: no API calls. */
  previewOnly: boolean;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Redemption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!code) return;
    let live = true;
    setRows(null);
    setFailed(false);
    if (previewOnly) { setRows([]); return; }
    api.discountCodes.uses(code.id)
      .then((data) => { if (live) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, code, previewOnly, attempt]);

  const total = (rows ?? []).reduce((sum, r) => sum + (r.appliedAmountCents ?? 0), 0);

  return (
    <Modal visible={!!code} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: theme.background }}>
        <ScreenHeader title={code ? `${code.code} redemptions` : 'Redemptions'} variant="modal" onBack={onClose} />
        {failed ? (
          <EmptyState icon="alert-circle" title="Couldn't load redemptions" message="Check your connection." actionLabel="Try again" onAction={() => setAttempt((n) => n + 1)} variant="error" />
        ) : rows === null ? (
          <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="No redemptions yet" message="Orders that use this code show up here." />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
            ListHeaderComponent={(
              <View style={s.totals}>
                <Text style={s.totalLine}>{rows.length} {rows.length === 1 ? 'use' : 'uses'}</Text>
                <Text style={s.totalMuted}>{formatCents(total)} off in total</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <View style={s.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.name} numberOfLines={1}>{item.customerName || 'Customer'}</Text>
                  <Text style={s.meta}>{whenLabel(item.usedAt)}</Text>
                </View>
                <Text style={s.amount}>−{formatCents(item.appliedAmountCents ?? 0)}</Text>
              </View>
            )}
          />
        )}
      </SafeAreaProvider>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  totals: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md, gap: 2 },
  totalLine: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  totalMuted: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 60, paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  amount: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
});

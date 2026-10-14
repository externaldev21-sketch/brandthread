/**
 * One-tap product import for new sellers.
 *
 * Paste a Shopify store link (reads the store's public catalog — no Shopify
 * app or keys) or, when the server flag is on and the seller already
 * connected Instagram through Meta, pull their photo posts. Every product
 * comes back ticked in a Shopify-style picker (photo, name, price · variants);
 * untick what you don't want and import. Everything lands as a draft — nothing
 * is visible to buyers until the seller reviews and publishes it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSuccess } from '@/lib/haptics';
import { formatCents } from '@/lib/money';
import type { ImportCommitResult, ImportProviders, QuickImportItem } from '@/lib/productImportTypes';

type Source = 'shopify-url' | 'instagram';
type Phase =
  | { kind: 'start' }
  | { kind: 'loading'; source: Source }
  | { kind: 'pick'; source: Source; label: string; items: QuickImportItem[]; notes: string[] }
  | { kind: 'done'; result: ImportCommitResult };

export default function QuickImportScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();

  const [providers, setProviders] = useState<ImportProviders | null>(null);
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    api.productImport.providers().then(setProviders).catch(() => {});
  }, [api, isSignedIn]);

  const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^API \d+:\s*/, '') : '') || 'Something went wrong. Try again.';

  const preview = useCallback(async (source: Source) => {
    setError(null);
    setPhase({ kind: 'loading', source });
    try {
      const res = await api.productImport.quickPreview(source, source === 'shopify-url' ? url.trim() : undefined);
      if (!res.items.length) {
        setPhase({ kind: 'start' });
        setError(source === 'instagram' ? 'No photo posts to import.' : 'No products found at that link.');
        return;
      }
      setSelected(new Set(res.items.map((i) => i.key)));
      setPhase({ kind: 'pick', source, label: res.layoutLabel, items: res.items, notes: [...res.notes] });
    } catch (e) {
      setPhase({ kind: 'start' });
      setError(messageOf(e));
    }
  }, [api, url]);

  async function commit() {
    if (phase.kind !== 'pick' || selected.size === 0) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await api.productImport.quickCommit(phase.source, [...selected], phase.source === 'shopify-url' ? url.trim() : undefined);
      hapticSuccess();
      setPhase({ kind: 'done', result });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setCommitting(false);
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const instagram = providers?.instagram?.enabled ? providers.instagram : null;

  // ── Picker ────────────────────────────────────────────────────────────────
  if (phase.kind === 'pick') {
    const allOn = selected.size === phase.items.length;
    return (
      <View style={s.root} testID="quick-import-picker">
        <ScreenHeader title={phase.label} onBack={() => setPhase({ kind: 'start' })} />
        <Pressable
          style={s.selectAll}
          onPress={() => setSelected(allOn ? new Set() : new Set(phase.items.map((i) => i.key)))}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allOn }}
        >
          <Check on={allOn} mixed={!allOn && selected.size > 0} theme={theme} />
          <Text style={s.selectAllText}>{selected.size} of {phase.items.length} selected</Text>
        </Pressable>
        <FlatList
          data={phase.items}
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListFooterComponent={phase.notes.length ? <Text style={s.note}>{phase.notes.join(' ')}</Text> : null}
          renderItem={({ item }) => {
            const on = selected.has(item.key);
            return (
              <Pressable style={s.row} onPress={() => toggle(item.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={item.name}>
                <Check on={on} theme={theme} />
                <View style={s.thumb}>
                  {item.image ? <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                </View>
                <View style={s.rowText}>
                  <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {item.priceFromCents > 0 ? formatCents(item.priceFromCents) : 'No price'}
                    {` · ${item.variantCount} ${item.variantCount === 1 ? 'variant' : 'variants'}`}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable
            style={[s.primary, (selected.size === 0 || committing) && { opacity: 0.3 }]}
            disabled={selected.size === 0 || committing}
            onPress={commit}
            accessibilityRole="button"
            testID="quick-import-commit"
          >
            {committing
              ? <ActivityIndicator color={theme.background} />
              : <Text style={s.primaryText}>Import {selected.size} as {selected.size === 1 ? 'draft' : 'drafts'}</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase.kind === 'done') {
    const c = phase.result.counts;
    const added = c.created + c.updated;
    return (
      <View style={s.root} testID="quick-import-done">
        <ScreenHeader title="Import" />
        <View style={s.doneBody}>
          <Text style={s.doneTitle}>{added} {added === 1 ? 'draft' : 'drafts'} added</Text>
          {c.unchanged > 0 ? <Text style={s.doneLine}>{c.unchanged} already imported, left as they were.</Text> : null}
          {c.failed + c.skipped + c.invalid > 0 ? <Text style={s.doneLine}>{c.failed + c.skipped + c.invalid} couldn't be imported.</Text> : null}
          {phase.result.planLimitReached ? <Text style={s.doneLine}>Your plan's product limit was reached.</Text> : null}
        </View>
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={s.primary} onPress={() => router.replace('/(tabs)/products' as never)} accessibilityRole="button" testID="quick-import-review">
            <Text style={s.primaryText}>Review drafts</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const loading = phase.kind === 'loading';
  return (
    <View style={s.root} testID="quick-import">
      <ScreenHeader title="Import products" />
      <View style={s.body}>
        <Text style={s.label}>Shopify store link</Text>
        <View style={s.field}>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="yourbrand.com"
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
            returnKeyType="go"
            onSubmitEditing={() => { if (url.trim()) void preview('shopify-url'); }}
            style={s.input}
            editable={!loading}
            testID="quick-import-url"
            accessibilityLabel="Shopify store link"
          />
        </View>
        <Pressable
          style={[s.primary, (!url.trim() || loading) && { opacity: 0.3 }]}
          disabled={!url.trim() || loading}
          onPress={() => preview('shopify-url')}
          accessibilityRole="button"
          testID="quick-import-find"
        >
          {loading && phase.source === 'shopify-url'
            ? <ActivityIndicator color={theme.background} />
            : <Text style={s.primaryText}>Find products</Text>}
        </Pressable>

        {instagram ? (
          <Pressable
            style={[s.secondary, loading && { opacity: 0.3 }]}
            disabled={loading}
            onPress={() => preview('instagram')}
            accessibilityRole="button"
            testID="quick-import-instagram"
          >
            {loading && phase.source === 'instagram'
              ? <ActivityIndicator color={theme.text} />
              : <Text style={s.secondaryText}>Import from Instagram{instagram.username ? ` (@${instagram.username})` : ''}</Text>}
          </Pressable>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}
        <Text style={s.fine}>Imported products are saved as drafts.</Text>
      </View>
    </View>
  );
}

function Check({ on, mixed, theme }: { on: boolean; mixed?: boolean; theme: ReturnType<typeof useAppTheme>['theme'] }) {
  return (
    <View style={[checkStyles.box, { borderColor: on || mixed ? theme.text : theme.border, backgroundColor: on || mixed ? theme.text : 'transparent' }]}>
      {on ? <Feather name="check" size={14} color={theme.background} /> : mixed ? <View style={[checkStyles.dash, { backgroundColor: theme.background }]} /> : null}
    </View>
  );
}

const checkStyles = StyleSheet.create({
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dash: { width: 10, height: 2, borderRadius: 1 },
});

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  body: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  label: { fontSize: 13, fontWeight: '600', color: theme.muted },
  field: {
    height: 52, borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center',
    backgroundColor: theme.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  input: { fontSize: 16, color: theme.text, paddingVertical: 0 },
  primary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text },
  primaryText: { fontSize: 16, fontWeight: '600', color: theme.background },
  secondary: {
    height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.border, marginTop: 8,
  },
  secondaryText: { fontSize: 16, fontWeight: '600', color: theme.text },
  error: { fontSize: 14, color: theme.error },
  fine: { fontSize: 13, color: theme.muted, marginTop: 4 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  selectAllText: { fontSize: 15, fontWeight: '600', color: theme.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginLeft: 16 + 22 + 12 },
  thumb: { width: 44, height: 55, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.surface },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: theme.text },
  rowMeta: { fontSize: 13, color: theme.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  note: { fontSize: 13, color: theme.muted, paddingHorizontal: 16, paddingTop: 16 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 8,
    backgroundColor: theme.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  doneBody: { paddingHorizontal: 16, paddingTop: 24, gap: 8 },
  doneTitle: { fontSize: 28, fontWeight: '700', color: theme.text, letterSpacing: -0.6 },
  doneLine: { fontSize: 15, color: theme.muted },
});

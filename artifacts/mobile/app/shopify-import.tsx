/**
 * Product transfer (A): "Import from Shopify" — the seller's whole catalog
 * (names, descriptions, photos, sizes/colors, prices, stock) in one go.
 *
 *   Import → Shopify's own sign-in + consent screen (read-only products and
 *   inventory) → back here → live progress ("23 of 61 products") → drafts in
 *   Products, ready to review and publish.
 *
 * Connection is ONLY through Shopify's OAuth consent screen: the seller never
 * copies a token, key or password. Until the server has Brandthread's
 * Shopify app credentials, the screen says the import is almost ready — it
 * never pretends to connect or import. Re-running updates the products it
 * brought in before rather than duplicating them. Never touches orders —
 * separate from Fulfillment via Shopify (app/integrations/shopify-fulfillment.tsx).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type ShopifyCatalogImportJob } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { isValidShopifyStoreHandle, shopifyStoreHandle } from '@/lib/shopifyStoreHandle';
import { FONT, FS, RADIUS, SP, TABULAR } from '@/lib/theme';

const RETURN_URL = 'brandthread://shopify-import';
const POLL_MS = 1500;
// How long to keep checking for the seller to finish on Shopify's screen.
const CONNECT_WAIT_MS = 10 * 60 * 1000;

type Status = { configured: boolean; connected: boolean; shopDomain?: string | null };
type Phase =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | { kind: 'connect' }
  | { kind: 'consent'; shopDomain: string }
  | { kind: 'ready'; shopDomain: string }
  | { kind: 'importing'; job: ShopifyCatalogImportJob }
  | { kind: 'done'; job: ShopifyCatalogImportJob };

const WHAT_COMES_OVER = [
  'Product names and descriptions',
  'Every photo',
  'Sizes, colors and other options',
  'Prices and stock for each variant',
];

function messageOf(e: unknown): string {
  return (e instanceof Error ? e.message.replace(/^API \d+:\s*/, '') : '') || 'Something went wrong. Try again.';
}

export default function ShopifyImportScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => createStyles(theme), [theme]);
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ shopify?: string }>();

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [store, setStore] = useState('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(params.shopify === 'error' ? 'Shopify didn\'t finish connecting. Try again.' : null);
  const mounted = useRef(true);
  const connectDeadline = useRef(0);
  // The poll, the AppState listener and connect() all call checkConsent; only
  // the first to see the connection may start the import (and none after Cancel).
  const consentSettled = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);

  const startImport = useCallback(async () => {
    setBusy(true);
    setInlineError(null);
    try {
      const job = await api.shopify.startCatalogImport();
      if (mounted.current) setPhase({ kind: 'importing', job });
    } catch (e) {
      if (mounted.current) setInlineError(messageOf(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [api]);

  const readStatus = useCallback(async (): Promise<Status> => api.shopify.status(), [api]);

  const load = useCallback(async () => {
    try {
      const [status, latest] = await Promise.all([readStatus(), api.shopify.latestCatalogImport().catch(() => null)]);
      if (!mounted.current) return;
      if (!status.configured && !status.connected) { setPhase({ kind: 'unavailable' }); return; }
      if (latest?.status === 'running') { setPhase({ kind: 'importing', job: latest }); return; }
      if (status.connected && status.shopDomain) { setPhase({ kind: 'ready', shopDomain: status.shopDomain }); return; }
      setPhase({ kind: 'connect' });
    } catch (e) {
      if (mounted.current) setPhase({ kind: 'error', message: messageOf(e) });
    }
  }, [api, readStatus]);

  useEffect(() => { void load(); }, [load]);

  // Waiting on Shopify's consent screen: check until the callback has stored
  // the connection, then go straight into the import the seller asked for.
  const checkConsent = useCallback(async () => {
    try {
      const status = await readStatus();
      if (!mounted.current) return true;
      if (status.connected) {
        if (consentSettled.current) return true;
        consentSettled.current = true;
        haptic('productListed');
        await startImport();
        return true;
      }
    } catch { /* keep waiting */ }
    return false;
  }, [readStatus, startImport]);

  useEffect(() => {
    if (phase.kind !== 'consent') return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (await checkConsent()) return;
      if (Date.now() > connectDeadline.current) {
        if (!stopped && mounted.current) {
          setPhase({ kind: 'connect' });
          setInlineError('We didn\'t hear back from Shopify. Try again.');
        }
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void checkConsent(); });
    return () => { stopped = true; clearTimeout(timer); sub.remove(); };
  }, [phase.kind, checkConsent]);

  // Live progress while the server imports.
  const jobId = phase.kind === 'importing' ? phase.job.id : null;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const job = await api.shopify.catalogImport(jobId);
        if (stopped || !mounted.current) return;
        if (job.status === 'running') {
          setPhase({ kind: 'importing', job });
        } else {
          haptic(job.status === 'complete' ? 'productListed' : 'error');
          setPhase({ kind: 'done', job });
          return;
        }
      } catch { /* transient — try again */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, jobId]);

  const connect = useCallback(async () => {
    const handle = shopifyStoreHandle(store);
    if (!isValidShopifyStoreHandle(handle)) {
      setInlineError('Enter your Shopify store name — the part before .myshopify.com.');
      return;
    }
    setBusy(true);
    setInlineError(null);
    try {
      const { authorizeUrl } = await api.shopify.connectStart(handle, 'import');
      connectDeadline.current = Date.now() + CONNECT_WAIT_MS;
      consentSettled.current = false;
      setPhase({ kind: 'consent', shopDomain: `${handle}.myshopify.com` });
      setBusy(false);
      // Shopify's own sign-in and consent page; it closes itself when the
      // callback hands back to RETURN_URL.
      await WebBrowser.openAuthSessionAsync(authorizeUrl, RETURN_URL);
      await checkConsent();
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      const message = messageOf(e);
      if (/not.configured|almost ready/i.test(message)) setPhase({ kind: 'unavailable' });
      else { setPhase({ kind: 'connect' }); setInlineError(message); }
    }
  }, [api, store, checkConsent]);

  const footer = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <View style={[s.footer, { paddingBottom: SP.md + insets.bottom }]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        style={({ pressed }) => [s.primary, (disabled || busy) && s.dimmed, pressed && s.pressed]}
        accessibilityRole="button"
        testID={testID}
      >
        {busy ? <ActivityIndicator color={theme.background} /> : <Text style={s.primaryText}>{label}</Text>}
      </Pressable>
    </View>
  );

  const whatComesOver = (
    <View style={s.list}>
      {WHAT_COMES_OVER.map((line) => (
        <View key={line} style={s.listRow}>
          <Icon name="check" size={16} color={theme.text} />
          <Text style={s.listText}>{line}</Text>
        </View>
      ))}
    </View>
  );

  let body: React.ReactNode = null;
  let action: React.ReactNode = null;

  switch (phase.kind) {
    case 'loading':
      body = <View style={s.center}><ActivityIndicator color={theme.text} /></View>;
      break;
    case 'error':
      body = (
        <View style={s.block}>
          <Text style={s.title}>Couldn't reach Brandthread</Text>
          <Text style={s.copy}>{phase.message}</Text>
        </View>
      );
      action = footer('Try again', () => { setPhase({ kind: 'loading' }); void load(); }, 'shopify-import-retry');
      break;
    case 'unavailable':
      body = (
        <View style={s.block} testID="shopify-import-unavailable">
          <Text style={s.title}>Shopify import is almost ready</Text>
          <Text style={s.copy}>
            We're finishing Brandthread's connection with Shopify. Once it's switched on, you'll sign in to Shopify
            here and your whole catalog comes over in one go — nothing to re-type.
          </Text>
          {whatComesOver}
          <Text style={s.fine}>Nothing has been imported yet. Check back soon, or add products another way for now.</Text>
        </View>
      );
      action = footer('Other ways to add products', () => router.push('/product-import' as never), 'shopify-import-other-ways');
      break;
    case 'connect':
      body = (
        <View style={s.block}>
          <Text style={s.title}>Bring your Shopify catalog over</Text>
          <Text style={s.copy}>Sign in to Shopify and approve Brandthread. Everything comes over as drafts for you to review.</Text>
          {whatComesOver}
          <Text style={s.label}>Your Shopify store</Text>
          <View style={s.field}>
            <TextInput
              value={store}
              onChangeText={(t) => { setStore(t); setInlineError(null); }}
              placeholder="your-store"
              placeholderTextColor={theme.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void connect()}
              style={s.input}
              accessibilityLabel="Shopify store name"
              testID="shopify-import-store"
            />
            <Text style={s.suffix}>.myshopify.com</Text>
          </View>
          {inlineError ? <Text style={s.inlineError}>{inlineError}</Text> : null}
          <Text style={s.fine}>
            Shopify asks you to approve read-only access to your products and inventory. Brandthread never sees your
            Shopify password and never touches your orders.
          </Text>
        </View>
      );
      action = footer('Continue to Shopify', () => void connect(), 'shopify-import-continue', !store.trim());
      break;
    case 'consent':
      body = (
        <View style={[s.block, s.centerBlock]} testID="shopify-import-consent">
          <ActivityIndicator color={theme.text} />
          <Text style={s.title}>Approve Brandthread on Shopify</Text>
          <Text style={s.copy}>Finish signing in on Shopify's page. Your import starts here as soon as you approve.</Text>
          <Text style={s.fine}>{phase.shopDomain}</Text>
        </View>
      );
      action = (
        <View style={[s.footer, { paddingBottom: SP.md + insets.bottom }]}>
          <Pressable onPress={() => { consentSettled.current = true; setPhase({ kind: 'connect' }); }} style={s.secondary} accessibilityRole="button" testID="shopify-import-cancel">
            <Text style={s.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      );
      break;
    case 'ready':
      body = (
        <View style={s.block}>
          <View style={s.connectedRow}>
            <Icon name="check-circle" size={16} color={theme.text} />
            <Text style={s.connectedText} numberOfLines={1}>Connected to {phase.shopDomain}</Text>
          </View>
          <Text style={s.title}>Import your catalog</Text>
          <Text style={s.copy}>
            Every product comes over as a draft in Products. Already imported some? Running it again updates them
            instead of adding copies.
          </Text>
          {whatComesOver}
          {inlineError ? <Text style={s.inlineError}>{inlineError}</Text> : null}
        </View>
      );
      action = footer('Import all products', () => void startImport(), 'shopify-import-start');
      break;
    case 'importing': {
      const { job } = phase;
      const total = job.totalCount;
      const ratio = total ? Math.min(1, job.processedCount / Math.max(total, 1)) : 0;
      body = (
        <View style={[s.block, s.centerBlock]} testID="shopify-import-progress">
          <Text style={s.title}>Importing from Shopify</Text>
          <Text style={[s.count, TABULAR]} accessibilityLiveRegion="polite">
            {total == null ? 'Counting products…' : `${job.processedCount} of ${total} products`}
          </Text>
          <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total ?? 0, now: job.processedCount }}>
            <View style={[s.bar, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
          <Text style={s.fine}>Copying photos, sizes, prices and stock. You can leave this screen — it keeps going.</Text>
        </View>
      );
      break;
    }
    case 'done': {
      const { job } = phase;
      const failed = job.status === 'failed';
      const landed = job.importedCount + job.updatedCount;
      body = (
        <ScrollView contentContainerStyle={s.block} testID="shopify-import-done">
          <Text style={s.title}>
            {failed ? 'Import stopped' : `${landed} product${landed === 1 ? '' : 's'} imported`}
          </Text>
          <Text style={[s.copy, TABULAR]}>
            {[
              job.importedCount ? `${job.importedCount} new` : null,
              job.updatedCount ? `${job.updatedCount} updated` : null,
              job.skippedCount ? `${job.skippedCount} skipped` : null,
            ].filter(Boolean).join(' · ') || 'No products came over.'}
          </Text>
          {failed && job.errorMessage ? <Text style={s.inlineError}>{job.errorMessage}</Text> : null}
          {!failed ? <Text style={s.copy}>They're drafts in Products — review each one and publish when you're ready.</Text> : null}
          {job.skipped.length > 0 ? (
            <View style={s.skipped}>
              {job.skipped.map((item) => (
                <Text key={item.shopifyProductId} style={s.skippedText} numberOfLines={2}>
                  {item.title ?? 'A product'} — {item.reason}
                </Text>
              ))}
            </View>
          ) : null}
          {job.imagesLinked > 0 ? (
            <Text style={s.fine}>{job.imagesLinked} photo{job.imagesLinked === 1 ? '' : 's'} couldn't be copied and still load from Shopify.</Text>
          ) : null}
        </ScrollView>
      );
      action = failed
        ? footer('Try again', () => void startImport(), 'shopify-import-again')
        : footer('View products', () => router.replace('/(tabs)/products' as never), 'shopify-import-view-products');
      break;
    }
  }

  return (
    <View style={s.root}>
      <ScreenHeader title="Import from Shopify" />
      <View style={{ flex: 1 }}>{body}</View>
      {action}
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: 120, gap: SP.sm + SP.xs },
  centerBlock: { alignItems: 'center', paddingTop: SP.xxl, gap: SP.md },
  title: { fontFamily: FONT.bold, fontSize: 22, lineHeight: 28, color: theme.text, textAlign: 'auto' },
  copy: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 20, color: theme.muted },
  fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: theme.subtle },
  label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.muted, marginTop: SP.sm },
  list: { gap: SP.sm, paddingVertical: SP.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  listText: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
  field: {
    height: 52, borderRadius: RADIUS.md, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.input, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  input: { flex: 1, minWidth: 0, fontFamily: FONT.regular, fontSize: 16, color: theme.text, paddingVertical: 0 },
  suffix: { fontFamily: FONT.regular, fontSize: 16, color: theme.subtle },
  inlineError: { fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 18, color: theme.text },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, alignSelf: 'flex-start', paddingVertical: SP.xs },
  connectedText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, flexShrink: 1 },
  count: { fontFamily: FONT.semibold, fontSize: FS.md, color: theme.text },
  track: { alignSelf: 'stretch', height: 6, borderRadius: RADIUS.pill, backgroundColor: theme.border, overflow: 'hidden' },
  bar: { height: 6, borderRadius: RADIUS.pill, backgroundColor: theme.text },
  skipped: { gap: SP.xs, paddingVertical: SP.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  skippedText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, color: theme.muted },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SP.md, paddingTop: SP.sm + SP.xs,
    backgroundColor: theme.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
  },
  primary: { height: 52, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text },
  primaryText: { fontFamily: FONT.semibold, fontSize: 16, color: theme.background },
  secondary: { height: 52, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
  secondaryText: { fontFamily: FONT.semibold, fontSize: 16, color: theme.text },
  dimmed: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});

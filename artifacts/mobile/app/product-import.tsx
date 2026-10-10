import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Modal, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { FONT, FS, SP, RADIUS, COMP, ICON, FILL_ELEVATED, TEXT_DISABLED } from '@/lib/theme';

import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SectionHeader, StatusBadge, EmptyState, FormInput } from '@/components/BrandthreadUI';

import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Header } from '@/components/layout';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ProductImportPreview } from '@/components/products/ProductImportPreview';
import type { ImportCommitResult, ImportPreview, ImportProviders, ImportRun } from '@/lib/productImportTypes';

function methodIcon(method: string): keyof typeof Feather.glyphMap {
  if (method === 'CSV') return 'file-text';
  if (method === 'Manual') return 'list';
  return 'package';
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProductImportScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const {
    background: BG, surface: SURFACE, card: CARD, border: BORDER,
    text: FG, muted: MUTED, subtle: SUBTLE, success: SUCCESS, error: RED,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, warning: GOLD,
  } = theme;
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [selectedMethod, setSelectedMethod] = useState<'csv' | 'shopify' | 'manual' | null>(null);

  // Manual bulk entry form state
  const [bulkNames, setBulkNames] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [importing, setImporting] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');

  const { isSignedIn } = useAuth();
  const [providers, setProviders] = useState<ImportProviders | null>(null);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: 'csv'; text: string; filename?: string } | { kind: 'etsy' } | null>(null);
  const [etsyBusy, setEtsyBusy] = useState(false);

  const loadProviders = useCallback(async () => {
    // Signed-out web preview has no token: never call the protected API.
    if (!isSignedIn) return;
    try {
      const [p, r] = await Promise.all([api.productImport.providers(), api.productImport.runs()]);
      setProviders(p);
      setRuns(r.runs);
    } catch { /* the method cards still work; Etsy stays hidden behind its own state */ }
  }, [api, isSignedIn]);

  useFocusEffect(useCallback(() => { void loadProviders(); }, [loadProviders]));
  useEffect(() => { void loadProviders(); }, [loadProviders]);

  function messageOf(error: unknown): string {
    const raw = error instanceof Error ? error.message : '';
    return raw.replace(/^API \d+:\s*/, '') || 'Something went wrong. Try again.';
  }

  async function startReview(next: NonNullable<typeof pending>) {
    setPending(next);
    setPreview(null);
    setResult(null);
    setReviewError(null);
    setReviewBusy(true);
    setReviewOpen(true);
    try {
      setPreview(next.kind === 'csv' ? await api.productImport.previewCsv(next.text) : await api.productImport.etsyPreview());
    } catch (error) {
      setReviewOpen(false);
      Alert.alert('Import', messageOf(error));
    } finally {
      setReviewBusy(false);
    }
  }

  async function commitReview() {
    if (!pending) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const res = pending.kind === 'csv'
        ? await api.productImport.commitCsv(pending.text, pending.filename)
        : await api.productImport.etsyCommit();
      setResult(res);
      void loadProviders();
    } catch (error) {
      setReviewError(messageOf(error));
    } finally {
      setReviewBusy(false);
    }
  }

  async function pickCsvFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const text = await (asset.file ? asset.file.text() : fetch(asset.uri).then((r) => r.text()));
      if (!text.trim()) { Alert.alert('Import', 'The file is empty.'); return; }
      void startReview({ kind: 'csv', text, filename: asset.name });
    } catch {
      Alert.alert('Import', "We couldn't read that file.");
    }
  }

  function importCsv() {
    if (!csvText.trim()) return;
    setShowCsvModal(false);
    void startReview({ kind: 'csv', text: csvText });
  }

  async function connectEtsy() {
    setEtsyBusy(true);
    try {
      const { authorizeUrl } = await api.productImport.etsyConnect();
      await WebBrowser.openAuthSessionAsync(authorizeUrl);
      await loadProviders();
    } catch (error) {
      Alert.alert('Etsy', messageOf(error));
    } finally {
      setEtsyBusy(false);
    }
  }

  function selectMethod(method: 'csv' | 'shopify' | 'manual') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMethod(prev => (prev === method ? null : method));
  }

  async function handleBulkCreate() {
    if (!bulkNames.trim()) return;
    const lines = bulkNames.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setImporting(true);
    try {
      const rows = lines.map(line => {
        const parts = line.split(/\t|\s*\|\s*/);
        return {
          name: parts[0]?.trim() ?? line,
          price: parts[1]?.trim() ?? (bulkPrice || '0'),
          category: parts[2]?.trim() ?? bulkCategory,
        };
      });
      const result = await api.products.import(rows);
      setBulkNames('');
      Alert.alert(
        'Import Complete',
        `Imported ${result.successCount} products.${result.failCount > 0 ? ` ${result.failCount} failed.` : ''}`,
        [
          {
            text: 'OK',
            onPress: () => {
              if (result.successCount > 0) goBackOr(router);
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  const bulkCount = bulkNames.split('\n').filter(l => l.trim().length > 0).length;

  return (
    <View style={s.screen}>
      <Header title="Import Products" dividerVariant="none" onBack={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); goBackOr(router); }} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + COMP.tabBarH + SP.md }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── METHOD A: CSV Import ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => selectMethod('csv')}
          glow={selectedMethod === 'csv'}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: theme.accentDim }]}>
              <Feather name="file-text" size={ICON.md} color={theme.accent} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>CSV File</Text>
              <Text style={s.methodDesc}>Upload a spreadsheet with your product catalogue</Text>
            </View>
            <StatusBadge label="Supported" variant="success" />
          </View>

          {selectedMethod === 'csv' && (
            <View style={s.expanded}>
              <View style={s.divider} />
              <BrandthreadCard style={s.stepsCard}>
                <Text style={s.stepText}>1. Export from Shopify or Etsy, or use the template</Text>
                <Text style={s.stepText}>2. Pick the file; layout is detected</Text>
                <Text style={s.stepText}>3. Review the preview, then import</Text>
              </BrandthreadCard>
              <PrimaryButton
                label="Choose CSV file"
                onPress={() => { void pickCsvFile(); }}
                icon="upload"
                style={s.expandedBtn}
                disabled={reviewBusy}
              />
              <SecondaryButton
                label="Paste CSV"
                onPress={() => setShowCsvModal(true)}
                icon="clipboard"
                style={s.expandedBtn}
                disabled={reviewBusy}
              />
              <SecondaryButton
                label="Download template"
                onPress={() => Alert.alert('CSV Template', 'name,description,category,price,sku,images,tags,size,color,stock\n"Product Name","Description","Tops",29.99,"TEE-1","https://example.com/a.jpg|https://example.com/b.jpg","cotton,basics","M","Black",10\n\nRows with the same name become variants of one product. Shopify and Etsy export files are recognised automatically.')}
                icon="download"
                style={s.expandedBtn}
              />
            </View>
          )}
        </GradientCard>

        {/* ── METHOD B: Shopify transfer (routes to the working transfer flow in Store Builder) ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/store-builder' as never); }}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: GOLD + '22' }]}>
              <Feather name="shopping-bag" size={ICON.md} color={GOLD} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>Transfer from Shopify</Text>
              <Text style={s.methodDesc}>Copy your public products in a few minutes</Text>
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </View>
        </GradientCard>

        {/* ── METHOD: Etsy (env-gated; reason shown only to the signed-in seller) ── */}
        {isSignedIn && providers ? (
          <GradientCard
            style={s.methodCard}
            onPress={() => {
              if (!providers.etsy.enabled || etsyBusy || reviewBusy) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (providers.etsy.connected) void startReview({ kind: 'etsy' });
              else void connectEtsy();
            }}
          >
            <View style={s.methodRow}>
              <View style={[s.methodIconWrap, { backgroundColor: theme.secondaryDim }]}>
                <Feather name="tag" size={ICON.md} color={providers.etsy.enabled ? theme.secondary : TEXT_DISABLED} />
              </View>
              <View style={s.methodInfo}>
                <Text style={[s.methodTitle, !providers.etsy.enabled && { color: TEXT_DISABLED }]}>Import from Etsy</Text>
                <Text style={[s.methodDesc, !providers.etsy.enabled && { color: TEXT_DISABLED }]}>
                  {!providers.etsy.enabled
                    ? (providers.etsy.reason ?? "Etsy import isn't enabled on this server.")
                    : providers.etsy.connected
                      ? "Import your active listings"
                      : 'Connect your shop to import active listings'}
                </Text>
              </View>
              {providers.etsy.enabled
                ? <StatusBadge label={providers.etsy.connected ? 'Connected' : 'Connect'} variant={providers.etsy.connected ? 'success' : 'neutral'} />
                : <StatusBadge label="Unavailable" variant="neutral" />}
            </View>
          </GradientCard>
        ) : null}

        {/* ── METHOD C: Manual Bulk Entry ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => selectMethod('manual')}
          glow={selectedMethod === 'manual'}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: theme.secondaryDim }]}>
              <Feather name="list" size={ICON.md} color={theme.secondary} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>Manual bulk entry</Text>
              <Text style={s.methodDesc}>Type in product names and details one line at a time</Text>
            </View>
            <StatusBadge label="Available" variant="success" />
          </View>

          {selectedMethod === 'manual' && (
            <View style={s.expanded}>
              <View style={s.divider} />
              <FormInput
                label="Product names (one per line)"
                value={bulkNames}
                onChange={setBulkNames}
                multiline
                placeholder={'Washed Oversized Tee\nHeavyweight Hoodie\nCargo Sweatpants'}
                style={s.formInput}
              />
              <FormInput
                label="Default category"
                value={bulkCategory}
                onChange={setBulkCategory}
                placeholder="e.g. Tops, Bottoms, Outerwear"
                style={s.formInput}
              />
              <FormInput
                label="Default price ($)"
                value={bulkPrice}
                onChange={setBulkPrice}
                keyboardType="decimal-pad"
                style={s.formInput}
              />
              <PrimaryButton
                label={importing ? 'Importing...' : `Import ${bulkCount} Product${bulkCount !== 1 ? 's' : ''}`}
                onPress={handleBulkCreate}
                icon="upload"
                style={s.expandedBtn}
                disabled={importing}
              />
            </View>
          )}
        </GradientCard>

        {/* ── Import History ── */}
        <SectionHeader title="Recent imports" style={s.sectionHeader} />

        {runs.length > 0 ? runs.map((run) => (
          <BrandthreadCard key={run.id} style={s.historyCard}>
            <View style={s.historyRow}>
              <View style={[s.historyIconWrap, { backgroundColor: theme.accentDim }]}>
                <Feather name={run.source === 'etsy_api' ? 'tag' : 'file-text'} size={ICON.sm} color={theme.accent} />
              </View>
              <View style={s.historyInfo}>
                <Text style={s.historyLabel} numberOfLines={1}>
                  {run.filename || (run.source === 'etsy_api' ? 'Etsy shop' : 'Pasted CSV')}
                </Text>
                <Text style={s.historyDate}>
                  {run.created} new · {run.updated} updated{run.failed + run.skipped > 0 ? ` · ${run.failed + run.skipped} not imported` : ''} · {new Date(run.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          </BrandthreadCard>
        )) : (
          <EmptyState
            icon="clock"
            title="No imports yet"
            description="Products you import will show up here."
          />
        )}
      </ScrollView>

      {/* ── CSV Paste Modal ── */}
      <Modal visible={showCsvModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCsvModal(false)}>
        <View style={{ flex: 1, backgroundColor: BG, padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontSize: 18, fontFamily: FONT.bold, color: FG }}>Paste CSV Data</Text>
            <TouchableOpacity
              onPress={() => setShowCsvModal(false)}
              style={{ width: 44, height: 44, backgroundColor: SURFACE, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}
              accessibilityRole="button"
              accessibilityLabel="Close paste CSV data"
            >
              <Feather name="x" size={18} color={FG} />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginBottom: 4 }}>
            Expected format: <Text style={{ color: FG }}>name, description, category, price, sku, images, tags, size, color, stock</Text>
          </Text>
          <Text style={{ fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginBottom: 12 }}>
            Paste your CSV content below (including the header row). Shopify and Etsy exports work too.
          </Text>
          <TextInput
            style={{ backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: 12, padding: 12, flex: 1, textAlignVertical: 'top' }}
            value={csvText}
            onChangeText={setCsvText}
            placeholder={'name,description,price,cost,category\n"My Product","A great product",29.99,12.00,"Tops"'}
            placeholderTextColor={MUTED}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={{ marginTop: 16, backgroundColor: !csvText.trim() ? FILL_ELEVATED : theme.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', shadowColor: theme.shadowColor }}
            disabled={!csvText.trim() || reviewBusy}
            activeOpacity={0.85}
            onPress={importCsv}
          >
            <Text style={{ fontSize: 15, fontFamily: FONT.bold, color: !csvText.trim() ? TEXT_DISABLED : theme.onAccent }}>
              Review import
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <ProductImportPreview
        visible={reviewOpen}
        preview={preview}
        result={result}
        busy={reviewBusy}
        error={reviewError}
        onClose={() => setReviewOpen(false)}
        onCommit={() => { void commitReview(); }}
        onViewProducts={() => { setReviewOpen(false); router.push('/(tabs)/products' as never); }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { background: BG, surface: SURFACE, card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM,
    success: SUCCESS, error: RED } = theme;
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: COMP.headerH,
  },
  backBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  scroll: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  methodCard: {
    marginBottom: SP.xs,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
  methodIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodInfo: {
    flex: 1,
    gap: 2,
  },
  methodTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  methodDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  expanded: {
    gap: SP.sm,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.sm,
  },
  stepsCard: {
    gap: SP.sm,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  stepText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },
  expandedBtn: {
    width: '100%',
  },
  noticeText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },
  formInput: {
    marginBottom: SP.xs,
  },
  sectionHeader: {
    marginTop: SP.md,
    paddingHorizontal: 0,
  },
  historyCard: {
    marginBottom: SP.xs,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
  },
  historyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyInfo: {
    flex: 1,
    gap: 2,
  },
  historyLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  historyDate: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  });
};

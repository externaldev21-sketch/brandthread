import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, ORANGE, RED, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  ON_DARK, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';

import {
  BrandthreadCard,
  GradientCard,
  PrimaryButton,
  SecondaryButton,
  IconButton,
  SectionHeader,
  StatusBadge,
  EmptyState,
  FormInput,
} from '@/components/BrandthreadUI';

import { useApi } from '@/lib/api';

// ─── Import History Demo Data ─────────────────────────────────────────────────

const IMPORT_HISTORY = [
  { date: 'Today', method: 'CSV', count: 12, status: 'success' },
  { date: 'Last week', method: 'Manual', count: 3, status: 'success' },
  { date: '2 weeks ago', method: 'CSV', count: 8, status: 'failed' },
] as const;

function methodIcon(method: string): keyof typeof Feather.glyphMap {
  if (method === 'CSV') return 'file-text';
  if (method === 'Manual') return 'list';
  return 'package';
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProductImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [selectedMethod, setSelectedMethod] = useState<'csv' | 'shopify' | 'manual' | null>(null);

  // Manual bulk entry form state
  const [bulkNames, setBulkNames] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const [importing, setImporting] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);

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
              if (result.successCount > 0) router.back();
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
    <View style={[s.screen, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Import Products</Text>
        <View style={{ width: COMP.iconBtn }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + COMP.tabBarH + SP.md }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Guided Tip ── */}
        <View style={s.tip}>
          <Feather name="zap" size={ICON.xs} color={CYAN} style={{ marginTop: 1 }} />
          <Text style={s.tipText}>
            Import allows you to bring existing products into Brandthread from another platform or a CSV file.
          </Text>
        </View>

        {/* ── METHOD A: CSV Import ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => selectMethod('csv')}
          glow={selectedMethod === 'csv'}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: PURPLE + '22' }]}>
              <Feather name="file-text" size={ICON.md} color={PURPLE} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>CSV File</Text>
              <Text style={s.methodDesc}>Upload a spreadsheet with your product data</Text>
            </View>
            <StatusBadge label="Supported" variant="success" />
          </View>

          {selectedMethod === 'csv' && (
            <View style={s.expanded}>
              <View style={s.divider} />
              <BrandthreadCard style={s.stepsCard}>
                <Text style={s.stepText}>1. Download our CSV template</Text>
                <Text style={s.stepText}>2. Fill in your product data</Text>
                <Text style={s.stepText}>3. Upload the completed file</Text>
              </BrandthreadCard>
              <PrimaryButton
                label="Download template"
                onPress={() => Alert.alert('CSV Template', 'name,description,price,cost,category\n"Product Name","Description",0,0,"Other"\n\nCopy this format for your import file.')}
                icon="download"
                style={s.expandedBtn}
              />
              <SecondaryButton
                label={csvUploading ? 'Importing...' : 'Upload CSV'}
                onPress={() => Alert.alert('Upload', 'File upload coming soon in production build')}
                icon="upload"
                style={s.expandedBtn}
                disabled={csvUploading}
              />
            </View>
          )}
        </GradientCard>

        {/* ── METHOD B: Shopify Import ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => selectMethod('shopify')}
          glow={selectedMethod === 'shopify'}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: GOLD + '22' }]}>
              <Feather name="shopping-bag" size={ICON.md} color={GOLD} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>Shopify</Text>
              <Text style={s.methodDesc}>Import products from your existing Shopify store</Text>
            </View>
            <StatusBadge label="Coming soon" variant="neutral" />
          </View>

          {selectedMethod === 'shopify' && (
            <View style={s.expanded}>
              <View style={s.divider} />
              <BrandthreadCard>
                <Text style={s.noticeText}>
                  Connect your Shopify store to enable automatic product sync. This feature requires the Shopify integration — available in the next update.
                </Text>
              </BrandthreadCard>
            </View>
          )}
        </GradientCard>

        {/* ── METHOD C: Manual Bulk Entry ── */}
        <GradientCard
          style={s.methodCard}
          onPress={() => selectMethod('manual')}
          glow={selectedMethod === 'manual'}
        >
          <View style={s.methodRow}>
            <View style={[s.methodIconWrap, { backgroundColor: CYAN + '22' }]}>
              <Feather name="list" size={ICON.md} color={CYAN} />
            </View>
            <View style={s.methodInfo}>
              <Text style={s.methodTitle}>Manual bulk entry</Text>
              <Text style={s.methodDesc}>Enter multiple products manually using a guided form</Text>
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
                placeholder={'Vintage Tee\nOversized Hoodie\nCargo Pants'}
                style={s.formInput}
              />
              <FormInput
                label="Default category"
                value={bulkCategory}
                onChange={setBulkCategory}
                placeholder="T-shirt"
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

        {IMPORT_HISTORY.map((item, idx) => (
          <BrandthreadCard key={idx} style={s.historyCard}>
            <View style={s.historyRow}>
              <View style={[s.historyIconWrap, { backgroundColor: item.status === 'success' ? SUCCESS + '18' : RED + '18' }]}>
                <Feather
                  name={methodIcon(item.method)}
                  size={ICON.sm}
                  color={item.status === 'success' ? SUCCESS : RED}
                />
              </View>
              <View style={s.historyInfo}>
                <Text style={s.historyLabel}>Imported {item.count} products</Text>
                <Text style={s.historyDate}>{item.date} · {item.method}</Text>
              </View>
              <StatusBadge
                label={item.status === 'success' ? 'Success' : 'Failed'}
                variant={item.status === 'success' ? 'success' : 'error'}
                small
              />
            </View>
          </BrandthreadCard>
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
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
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: CYAN,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    marginBottom: SP.xs,
  },
  tipText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 18,
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

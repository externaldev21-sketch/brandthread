import React from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { StatusBadge, PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import type { ImportCommitResult, ImportPreview } from '@/lib/productImportTypes';

type Props = {
  visible: boolean;
  preview: ImportPreview | null;
  result: ImportCommitResult | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCommit: () => void;
  onViewProducts: () => void;
  /** Publish the products this import created (they arrive as drafts). */
  onPublishCreated?: () => void;
  publishing?: boolean;
  /** How many were published, once done. */
  published?: number | null;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProductImportPreview({ visible, preview, result, busy, error, onClose, onCommit, onViewProducts, onPublishCreated, publishing = false, published = null }: Props) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  if (!preview && !result) return null;
  const importable = preview ? preview.counts.create + preview.counts.update : 0;
  const drafts = result ? result.results.filter((r) => r.action === 'created' && r.productId).length : 0;
  const canPublish = !!onPublishCreated && drafts > 0 && published == null;
  const cap = preview?.capacity;
  const toWrite = preview
    ? Math.min(importable, cap?.remaining != null ? preview.counts.update + cap.remaining : importable)
    : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <View style={s.top}>
          <Text style={s.title}>{result ? 'Import finished' : 'Review import'}</Text>
          <TouchableOpacity onPress={onClose} style={s.close} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {result ? (
            <>
              <View style={s.tiles}>
                <Tile s={s} label="Created" value={result.counts.created} />
                <Tile s={s} label="Updated" value={result.counts.updated} />
                <Tile s={s} label="Unchanged" value={result.counts.unchanged} />
                <Tile s={s} label="Not imported" value={result.counts.failed + result.counts.skipped + result.counts.invalid} />
              </View>
              {result.planLimitReached ? (
                <Text style={s.line}>Your plan's product limit was reached, so some new products were skipped. Upgrade to add more.</Text>
              ) : null}
              <Text style={s.line}>
                {published != null
                  ? `${published} new product${published === 1 ? ' is' : 's are'} live in your store.`
                  : 'New products are saved as drafts. Publish them now or from Products.'}
              </Text>
              {result.results.filter((r) => r.action === 'failed' || r.action === 'skipped' || r.notes?.length).slice(0, 30).map((r, i) => (
                <View key={`${r.name}-${i}`} style={s.issue}>
                  <Feather name="alert-triangle" size={14} color={theme.muted} style={s.issueIcon} />
                  <Text style={s.issueText}><Text style={s.issueName}>{r.name}</Text>{'  '}{r.reason ?? r.notes?.join(' ')}</Text>
                </View>
              ))}
              {result.issues.filter((i) => i.severity === 'error').slice(0, 30).map((i, n) => (
                <View key={`e${n}`} style={s.issue}>
                  <Feather name="alert-triangle" size={14} color={theme.muted} style={s.issueIcon} />
                  <Text style={s.issueText}>Row {i.line}{i.product ? ` · ${i.product}` : ''}  {i.message}</Text>
                </View>
              ))}
            </>
          ) : preview ? (
            <>
              <View style={s.badgeRow}>
                <StatusBadge label={`${preview.layoutLabel} detected`} variant="neutral" />
                <Text style={s.muted}>{preview.rowCount.toLocaleString()} row{preview.rowCount === 1 ? '' : 's'}</Text>
              </View>
              <View style={s.tiles}>
                <Tile s={s} label="Products" value={preview.counts.products} />
                <Tile s={s} label="Variants" value={preview.counts.variants} />
                <Tile s={s} label="New" value={preview.counts.create} />
                <Tile s={s} label="Updates" value={preview.counts.update} />
              </View>
              {preview.counts.unchanged > 0 ? <Text style={s.line}>{preview.counts.unchanged} already imported and unchanged.</Text> : null}
              {cap?.limit != null ? (
                <Text style={s.line}>Plan limit: {cap.used} of {cap.limit} products used.</Text>
              ) : null}

              {preview.issues.length > 0 ? (
                <>
                  <Text style={s.section}>{preview.counts.errors} error{preview.counts.errors === 1 ? '' : 's'}, {preview.counts.warnings} warning{preview.counts.warnings === 1 ? '' : 's'}</Text>
                  {preview.issues.map((i, n) => (
                    <View key={n} style={s.issue}>
                      <Feather name={i.severity === 'error' ? 'x-circle' : 'alert-triangle'} size={14} color={i.severity === 'error' ? theme.text : theme.muted} style={s.issueIcon} />
                      <Text style={s.issueText}>
                        {i.line > 0 ? `Row ${i.line}` : 'File'}{i.product ? ` · ${i.product}` : ''}{'  '}{i.message}
                      </Text>
                    </View>
                  ))}
                  {preview.issuesTruncated ? <Text style={s.muted}>More issues are not shown.</Text> : null}
                </>
              ) : null}

              {preview.sample.length > 0 ? (
                <>
                  <Text style={s.section}>Sample</Text>
                  {preview.sample.map((p, n) => (
                    <View key={n} style={s.sample}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sampleName} numberOfLines={1}>{p.name}</Text>
                        <Text style={s.muted}>{p.variantCount} variant{p.variantCount === 1 ? '' : 's'} · from {money(p.priceFromCents)} · {p.imageCount} image{p.imageCount === 1 ? '' : 's'}</Text>
                      </View>
                      <StatusBadge label={p.action === 'create' ? 'New' : p.action === 'update' ? 'Update' : 'Unchanged'} variant="neutral" small />
                    </View>
                  ))}
                </>
              ) : null}
              {preview.ignoredColumns.length > 0 ? (
                <Text style={s.muted}>Not imported: {preview.ignoredColumns.slice(0, 8).join(', ')}{preview.ignoredColumns.length > 8 ? '…' : ''}</Text>
              ) : null}
              {preview.notes.map((n) => <Text key={n} style={s.muted}>{n}</Text>)}
            </>
          ) : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
        </ScrollView>

        <View style={s.footer}>
          {result && canPublish ? (
            <>
              <PrimaryButton
                label={`Publish ${drafts} product${drafts === 1 ? '' : 's'}`}
                onPress={onPublishCreated!}
                loading={publishing}
                disabled={publishing}
                style={s.btn}
              />
              <SecondaryButton label="View products" onPress={onViewProducts} disabled={publishing} style={s.btn} />
            </>
          ) : result ? (
            <>
              <PrimaryButton label="View products" onPress={onViewProducts} style={s.btn} />
              <SecondaryButton label="Done" onPress={onClose} style={s.btn} />
            </>
          ) : busy ? (
            <View style={s.busy}><ActivityIndicator color={theme.text} /><Text style={s.muted}>Importing…</Text></View>
          ) : (
            <>
              <PrimaryButton
                label={toWrite > 0 ? `Import ${toWrite} product${toWrite === 1 ? '' : 's'}` : 'Nothing to import'}
                onPress={onCommit}
                disabled={toWrite === 0}
                style={s.btn}
              />
              <SecondaryButton label="Cancel" onPress={onClose} style={s.btn} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Tile({ s, label, value }: { s: ReturnType<typeof makeStyles>; label: string; value: number }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{value.toLocaleString()}</Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm },
  title: { fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.3 },
  close: { width: 44, height: 44, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: SP.md, paddingBottom: SP.lg, gap: SP.sm },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tiles: { flexDirection: 'row', gap: SP.xs },
  tile: { flex: 1, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.sm, paddingVertical: SP.sm, alignItems: 'center' },
  tileValue: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  tileLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  line: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20 },
  muted: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },
  section: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, marginTop: SP.sm },
  issue: { flexDirection: 'row', gap: SP.xs, alignItems: 'flex-start' },
  issueIcon: { marginTop: 3 },
  issueText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 20 },
  issueName: { fontFamily: FONT.semibold, color: theme.text },
  sample: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.sm, padding: SP.sm },
  sampleName: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  error: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20 },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  btn: { width: '100%' },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, paddingVertical: SP.md },
});

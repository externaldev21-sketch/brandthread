import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { File, Paths } from 'expo-file-system';

import * as Sharing from 'expo-sharing';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { useApi } from '@/lib/api';

import { ScreenHeader } from '@/components/ScreenHeader';

import { Button, Card, ListRow, StickyBottomCTA } from '@/components/ui';

import { haptics, haptic } from '@/lib/haptics';


import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { EmailExportSection } from '@/components/security/EmailExportSection';
import { saveExportFile } from '@/lib/saveExportFile';

/**
 * Item 122: the instant export is only "ready" once a file actually reached
 * the person: a browser download on web, the share sheet on native. With
 * no share sheet the file never leaves the app's cache, so that is reported
 * as an error pointing at the emailed link instead of a fake success.
 */
export const EXPORT_NO_SHARE_SHEET = "This device can't open a share sheet, so the file couldn't be saved. Use the emailed download link below instead.";
export const EXPORT_FAILED = "Couldn't prepare your data. Check your connection and try again.";

export function dataExportFilename(now: number = Date.now()): string {
  return `brandthread-my-data-${now}.json`;
}

type DataCategory = { key: string; label: string; sub: string; icon: IconName; selected: boolean };

const DEFAULT_CATEGORIES: DataCategory[] = [
  { key: 'profile', label: 'Profile & account', sub: 'Name, bio, settings', icon: 'user', selected: true },
  { key: 'messages', label: 'Messages', sub: 'Conversation history', icon: 'message-circle', selected: true },
  { key: 'orders', label: 'Order history', sub: 'Purchases and seller orders', icon: 'shopping-bag', selected: true },
];

export default function BuyerDownloadData() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const s = makeStyles(palette);
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [requested, setRequested] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [categories, setCategories] = useState<DataCategory[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(false);
  // Inline, not Alert: RN-web's Alert is a no-op, so the website would show nothing.
  const [error, setError] = useState<string | null>(null);

  function toggleCat(key: string) {
    setCategories(prev => prev.map(c => c.key === key ? { ...c, selected: !c.selected } : c));
  }

  async function handleRequest() {
    const selected = categories.filter(c => c.selected).map(c => c.key) as Array<'profile' | 'orders' | 'messages'>;
    if (selected.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.auth.exportData(selected);
      const delivered = await saveExportFile({
        filename: dataExportFilename(),
        mimeType: 'application/json',
        encoding: 'utf8',
        data: JSON.stringify(data, null, 2),
      }, 'Download my Brandthread data');
      if (!delivered) {
        hapticError();
        setError(EXPORT_NO_SHARE_SHEET);
        return;
      }
      
      setRequestedAt(data.exportedAt);
      setRequested(true);
    } catch {
      haptic('error');
      Alert.alert('Export failed', "Couldn't prepare your data. Try again.");
      setError(EXPORT_FAILED);
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = categories.filter(c => c.selected).length;

  const formattedDate = requestedAt
    ? new Date(requestedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <View style={s.page}>
      <ScreenHeader title="Download my data" />

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + (requested ? 40 : 120) }}>
        {requested ? (
          <View style={s.successCard}>
            <Icon name="check-circle" size={40} color={theme.success} />
            <Text style={s.successTitle}>Export ready</Text>
            {formattedDate && <Text style={s.successDate}>Generated {formattedDate}</Text>}
            <Text style={s.successDesc}>
              Your file was downloaded or handed to your share sheet. Save it or send it anywhere.
            </Text>
            <Button label="Generate another export" onPress={() => setRequested(false)} variant="tertiary" size="small" style={s.againBtn} />
          </View>
        ) : (
          <>
            <Text style={s.intro}>
              Select the categories to include. We'll bundle the selected info into one file and open your device's download/share options.
            </Text>

            <Text style={s.groupLabel}>Select what to include</Text>
            <Card style={s.card}>
              {categories.map((cat, i) => (
                <React.Fragment key={cat.key}>
                  <ListRow
                    icon={cat.icon}
                    title={cat.label}
                    subtitle={cat.sub}
                    toggle={{ value: cat.selected, onChange: () => toggleCat(cat.key) }}
                    onPress={() => toggleCat(cat.key)}
                  />
                  {i < categories.length - 1 && <View style={s.divider} />}
                </React.Fragment>
              ))}
            </Card>

            <View style={s.note}>
              <Icon name="info" size={14} color={palette.mutedForeground} />
              <Text style={s.noteText}>
                Only records your account owns are included.
              </Text>
            </View>

            {error && (
              <View style={[s.note, s.errorNote]} accessibilityRole="alert" testID="download-data-error">
                <Feather name="alert-triangle" size={14} color={palette.foreground} />
                <Text style={[s.noteText, { color: palette.foreground }]}>{error}</Text>
              </View>
            )}

            <EmailExportSection categories={categories.filter(c => c.selected).map(c => c.key)} />
          </>
        )}
      </ScrollView>

      {!requested && (
        <StickyBottomCTA
          label={loading ? 'Generating…' : 'Download'}
          icon={loading ? undefined : 'download'}
          onPress={() => { void handleRequest(); }}
          loading={loading}
          disabled={selectedCount === 0}
          header={<Text style={s.footerCount}>{selectedCount} of {categories.length} categories selected</Text>}
        />
      )}
    </View>
  );
}

const makeStyles = (palette: ReturnType<typeof useColors>) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  intro: { ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 18, marginBottom: SPACING.md },
  groupLabel: { ...TYPE_SCALE.caption, color: palette.mutedForeground, marginBottom: SPACING.xs },
  // Side padding so the switches sit inset from the card's right edge, the
  // same as the icons on the left (audit QA-0376/1043).
  card: { padding: 0, paddingHorizontal: SPACING.md, overflow: 'hidden', marginBottom: SPACING.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: 32 + SPACING.sm },
  note: { flexDirection: 'row', gap: 8, padding: SPACING.sm, backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: 'flex-start' },
  noteText: { flex: 1, ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 17 },
  footerCount: { ...TYPE_SCALE.caption, color: palette.mutedForeground, textAlign: 'center', fontVariant: ['tabular-nums'] },
  errorNote: { marginTop: SPACING.sm },
  successCard: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.md },
  successTitle: { ...TYPE_SCALE.title2, color: palette.foreground },
  successDate: { ...TYPE_SCALE.footnote, color: palette.mutedForeground },
  successDesc: { ...TYPE_SCALE.callout, color: palette.mutedForeground, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  againBtn: { marginTop: SPACING.xs },
});

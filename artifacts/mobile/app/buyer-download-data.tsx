import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button, Card, ListRow, StickyBottomCTA } from '@/components/ui';
import { hapticError, hapticSuccess, hapticToggle } from '@/lib/haptics';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

type DataCategory = { key: string; label: string; sub: string; icon: keyof typeof Feather.glyphMap; selected: boolean };

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

  function toggleCat(key: string) {
    hapticToggle();
    setCategories(prev => prev.map(c => c.key === key ? { ...c, selected: !c.selected } : c));
  }

  async function handleRequest() {
    const selected = categories.filter(c => c.selected).map(c => c.key) as Array<'profile' | 'orders' | 'messages'>;
    if (selected.length === 0) return;
    setLoading(true);
    try {
      const data = await api.auth.exportData(selected);
      const file = new File(Paths.cache, `brandthread-my-data-${Date.now()}.json`);
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Download my Brandthread data',
        });
      } else {
        Alert.alert('Export ready', 'Your data is ready. Save it or send it anywhere.');
      }
      hapticSuccess();
      setRequestedAt(data.exportedAt);
      setRequested(true);
    } catch (err: any) {
      hapticError();
      Alert.alert('Export failed', "Couldn't prepare your data. Try again.");
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
      <ScreenHeader title="Download your data" />

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + (requested ? 40 : 120) }}>
        {requested ? (
          <View style={s.successCard}>
            <Feather name="check-circle" size={40} color={theme.success} />
            <Text style={s.successTitle}>Export ready</Text>
            {formattedDate && <Text style={s.successDate}>Generated {formattedDate}</Text>}
            <Text style={s.successDesc}>
              Your data is ready. Save it or send it anywhere.
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
              <Feather name="info" size={14} color={palette.mutedForeground} />
              <Text style={s.noteText}>
                Only records your account owns are included.
              </Text>
            </View>
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
  groupLabel: { ...TYPE_SCALE.caption, color: palette.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.xs },
  card: { padding: 0, overflow: 'hidden', marginBottom: SPACING.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginLeft: SPACING.md + 32 + SPACING.sm },
  note: { flexDirection: 'row', gap: 8, padding: SPACING.sm, backgroundColor: palette.card, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: 'flex-start' },
  noteText: { flex: 1, ...TYPE_SCALE.footnote, color: palette.mutedForeground, lineHeight: 17 },
  footerCount: { ...TYPE_SCALE.caption, color: palette.mutedForeground, textAlign: 'center' },
  successCard: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.md },
  successTitle: { ...TYPE_SCALE.title2, color: palette.foreground },
  successDate: { ...TYPE_SCALE.footnote, color: palette.mutedForeground },
  successDesc: { ...TYPE_SCALE.callout, color: palette.mutedForeground, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  againBtn: { marginTop: SPACING.xs },
});

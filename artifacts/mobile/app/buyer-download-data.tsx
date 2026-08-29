import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM,
  ON_DARK, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';

type DataCategory = { key: string; label: string; sub: string; icon: keyof typeof Feather.glyphMap; selected: boolean };

const DEFAULT_CATEGORIES: DataCategory[] = [
  { key: 'profile', label: 'Profile & account', sub: 'Name, bio, settings', icon: 'user', selected: true },
  { key: 'messages', label: 'Messages', sub: 'Conversation history', icon: 'message-circle', selected: true },
  { key: 'orders', label: 'Order history', sub: 'Purchases and seller orders', icon: 'shopping-bag', selected: true },
];

export default function BuyerDownloadData() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const s = makeStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [requested, setRequested] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [categories, setCategories] = useState<DataCategory[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(false);

  function toggleCat(key: string) {
    Haptics.selectionAsync();
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
        Alert.alert('Export ready', `Your export was saved to ${file.uri}`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRequestedAt(data.exportedAt);
      setRequested(true);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Export failed', err?.message ?? 'Could not generate your data export. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const selectedCount = categories.filter(c => c.selected).length;

  const formattedDate = requestedAt
    ? new Date(requestedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Download Your Data</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 100 }}>
        {requested ? (
          <View style={s.successCard}>
            <Feather name="check-circle" size={40} color={SUCCESS} />
            <Text style={s.successTitle}>Export ready</Text>
            {formattedDate && <Text style={s.successDate}>Generated {formattedDate}</Text>}
            <Text style={s.successDesc}>
              Your JSON archive was generated from your authenticated Brandthread account and opened in your device's share sheet.
            </Text>
            <TouchableOpacity onPress={() => setRequested(false)} style={s.againBtn}>
              <Text style={[s.againText, { color: PURPLE }]}>Generate another export</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.intro}>
              Select the categories to include. Brandthread will generate a JSON archive immediately and open your device's download/share options.
            </Text>

            <Text style={s.groupLabel}>Select what to include</Text>
            <View style={s.card}>
              {categories.map((cat, i) => (
                <React.Fragment key={cat.key}>
                  <TouchableOpacity style={s.row} onPress={() => toggleCat(cat.key)} activeOpacity={0.7}>
                    <Feather name={cat.icon} size={19} color={PURPLE} style={{ width: 28 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.label}>{cat.label}</Text>
                      <Text style={s.sub}>{cat.sub}</Text>
                    </View>
                    <Switch
                      value={cat.selected}
                      onValueChange={() => toggleCat(cat.key)}
                      trackColor={{ false: CARD_ELEVATED, true: PURPLE }}
                      thumbColor={ON_DARK}
                    />
                  </TouchableOpacity>
                  {i < categories.length - 1 && <View style={s.divider} />}
                </React.Fragment>
              ))}
            </View>

            <View style={s.note}>
              <Feather name="info" size={14} color={MUTED} />
              <Text style={s.noteText}>
                The server uses your signed-in identity and only exports records your account owns or can access.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {!requested && (
        <View style={[s.footer, { paddingBottom: insets.bottom + SP.md }]}>
          <Text style={s.footerCount}>{selectedCount} of {categories.length} categories selected</Text>
          <TouchableOpacity
            onPress={handleRequest}
            activeOpacity={selectedCount > 0 ? 0.85 : 1}
            style={{ opacity: selectedCount > 0 ? 1 : 0.4 }}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.requestBtn}>
              <Feather name="download" size={18} color={theme.onAccent} />
              <Text style={[s.requestBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                {loading ? 'Generating…' : 'Download My Data'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: BG },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  intro: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18, marginBottom: SP.md },
  groupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
  label: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  note: { flexDirection: 'row', gap: 8, padding: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'flex-start' },
  noteText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, lineHeight: 17 },
  footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER, gap: SP.sm },
  footerCount: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center' },
  requestBtn: { height: 50, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SP.sm },
  requestBtnText: { fontFamily: FONT.bold, fontSize: FS.base, color: ON_DARK },
  successCard: { alignItems: 'center', paddingVertical: SP.xxl, gap: SP.md },
  successTitle: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },
  successDate: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  successDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  againBtn: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
  againText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

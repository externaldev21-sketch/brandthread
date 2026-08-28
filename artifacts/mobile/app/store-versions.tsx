import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge, EmptyState } from '@/components/BrandthreadUI';
import { getVersions, createVersion, restoreVersion } from '@/services/storeService';
import { StoreVersion } from '@/services/storeTypes';

function triggerVariant(trigger: StoreVersion['trigger']): { label: string; variant: 'success' | 'purple' | 'info' | 'neutral' } {
  if (trigger === 'publish') return { label: 'Published', variant: 'success' };
  if (trigger === 'theme_change') return { label: 'Theme Change', variant: 'purple' };
  if (trigger === 'ai_change') return { label: 'AI Change', variant: 'info' };
  if (trigger === 'section_change') return { label: 'Section Change', variant: 'info' };
  return { label: 'Manual', variant: 'neutral' };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export default function StoreVersionsScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const headerTopInset = useHeaderTopInset();
  const [versions, setVersions] = useState<StoreVersion[]>([]);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // getVersions() fetches from DB first (survives server restarts + app
  // reinstalls) and back-fills the AsyncStorage cache for offline access.
  const load = useCallback(async () => {
    const v = await getVersions();
    setVersions(v);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSaveVersion = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await createVersion(newLabel.trim());
      await load();
      setCreating(false);
      setNewLabel('');
      Alert.alert('Saved', 'Version saved successfully.');
    } catch {
      Alert.alert('Save failed', 'Could not save version to the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = (ver: StoreVersion) => {
    Alert.alert(
      'Restore this version?',
      'This will replace your current homepage sections, colors, and theme settings. Your products, collections, pages, and policies will not change.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore', onPress: async () => {
            await restoreVersion(ver.id);
            await load();
            Alert.alert('Restored', 'Version restored.');
          },
        },
      ],
    );
  };

  return (
    <View style={vs.root}>
      <View style={[vs.header, { paddingTop: headerTopInset + SP.sm }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={vs.backBtn}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={vs.headerTitle}>Version History</Text>
        <TouchableOpacity onPress={() => setCreating(true)} style={vs.saveVersionBtn}>
          <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
          <Text style={vs.saveVersionText}>Save Version</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={vs.scroll}>

        {creating && (
          <BrandthreadCard style={vs.card}>
            <Text style={vs.fieldLabel}>Version Label</Text>
            <TextInput
              style={vs.input}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="e.g. 'Before rebrand' or 'Summer 2026'"
              placeholderTextColor={SUBTLE}
              autoFocus
            />
            <View style={vs.actionRow}>
              <SecondaryButton label="Cancel" small accent={MUTED} onPress={() => { setCreating(false); setNewLabel(''); }} style={{ flex: 1 }} />
              <PrimaryButton label={saving ? 'Saving...' : 'Save'} small onPress={handleSaveVersion} loading={saving} style={{ flex: 1 }} />
            </View>
          </BrandthreadCard>
        )}

        {versions.length === 0 ? (
          <EmptyState
            icon="clock"
            title="No versions yet"
            description="Versions are saved automatically when you publish, change themes, or apply AI changes. You can also save manually."
            action={{ label: 'Save Current Version', onPress: () => setCreating(true), icon: 'plus' }}
            style={vs.emptyState}
          />
        ) : (
          versions.map(ver => {
            const { label: badgeLabel, variant } = triggerVariant(ver.trigger);
            return (
              <BrandthreadCard key={ver.id} style={vs.card}>
                <View style={vs.verRow}>
                  <Text style={vs.verLabel} numberOfLines={1}>{ver.label}</Text>
                  <StatusBadge label={badgeLabel} variant={variant} small />
                </View>
                <Text style={vs.verDate}>{formatDate(ver.createdAt)}</Text>
                <View style={vs.actionRow}>
                  <SecondaryButton
                    label="Restore"
                    small
                    accent={PURPLE_LIGHT}
                    onPress={() => handleRestore(ver)}
                    icon="rotate-ccw"
                    style={{ flex: 1 }}
                  />
                </View>
              </BrandthreadCard>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const vs = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, flex: 1 },
  saveVersionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saveVersionText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  actionRow: { flexDirection: 'row', gap: SP.sm },
  emptyState: { paddingTop: SP.xxl },
  verRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  verLabel: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, flex: 1 },
  verDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

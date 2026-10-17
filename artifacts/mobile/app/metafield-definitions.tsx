/**
 * Metafield definitions for one store resource — list, add, edit, delete.
 * Route: /metafield-definitions?resource=products&label=Products
 * Opened from a row on metafields.tsx. Backed by /api/seller/metafields
 * (seller-metafields.ts, table from migration 285).
 */
import React, { useCallback, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionError } from '@/components/InlineFeedback';
import { useApi } from '@/lib/api';
import { apiErrorMessage } from '@/lib/freelancer';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import {
  METAFIELD_TYPE_OPTIONS, metafieldTypeLabel, keyFromName, validateMetafieldDraft,
  type MetafieldDraft,
} from '@/lib/metafields';

interface Definition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  type: string;
  description: string | null;
  pinned: boolean;
}

const EMPTY_DRAFT: MetafieldDraft = { name: '', key: '', type: 'single_line_text_field', description: '' };

export default function MetafieldDefinitionsScreen() {
  const colors = useColors();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { resource = 'products', label } = useLocalSearchParams<{ resource?: string; label?: string }>();
  const [defs, setDefs] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<MetafieldDraft>(EMPTY_DRAFT);
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.seller.metafieldsByResource(resource) as { definitions?: Definition[] };
      setDefs(Array.isArray(data?.definitions) ? data.definitions : []);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load custom fields.'));
    } finally {
      setLoading(false);
    }
  }, [api, resource]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function openNew() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setKeyTouched(false);
    setFormOpen(true);
  }

  function openEdit(def: Definition) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setEditing(def);
    setDraft({ name: def.name, key: def.key, type: def.type, description: def.description ?? '' });
    setKeyTouched(true);
    setFormOpen(true);
  }

  async function save() {
    const problem = validateMetafieldDraft(draft, !editing);
    if (problem) { Alert.alert('Check this field', problem); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.seller.updateMetafield(editing.id, {
          name: draft.name.trim(),
          type: draft.type,
          description: draft.description.trim() || null,
        });
      } else {
        await api.seller.createMetafield({
          ownerResource: resource,
          key: draft.key,
          name: draft.name.trim(),
          type: draft.type,
          description: draft.description.trim() || null,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setFormOpen(false);
      await load();
    } catch (e) {
      Alert.alert('Could not save', apiErrorMessage(e, 'Your field was not saved. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(def: Definition) {
    Alert.alert('Delete this field?', `"${def.name}" will be removed from ${label ?? resource}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await api.seller.deleteMetafield(def.id);
            setFormOpen(false);
            await load();
          } catch (e) {
            Alert.alert('Could not delete', apiErrorMessage(e, 'The field was not deleted. Please try again.'));
          }
        },
      },
    ]);
  }

  async function togglePinned(def: Definition) {
    try {
      await api.seller.updateMetafield(def.id, { pinned: !def.pinned });
      await load();
    } catch (e) {
      Alert.alert('Could not update', apiErrorMessage(e));
    }
  }

  const inputStyle = [s.input, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }];

  return (
    <View style={s.container}>
      <ScreenHeader
        title={label ? `${label} fields` : 'Custom fields'}
        rightElement={
          <TouchableOpacity onPress={openNew} accessibilityRole="button" accessibilityLabel="Add field" hitSlop={8}>
            <Feather name="plus" size={22} color={colors.foreground} />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
        ) : error ? (
          <SectionError message={error} onRetry={() => { setLoading(true); void load(); }} />
        ) : defs.length === 0 ? (
          <View style={s.center}>
            <Feather name="list" size={24} color={colors.mutedForeground} />
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>No custom fields yet</Text>
            <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
              Add a field to store extra details, like fabric or care instructions.
            </Text>
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.primary }]} onPress={openNew}>
              <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Add field</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {defs.map((def, i) => (
              <TouchableOpacity
                key={def.id}
                onPress={() => openEdit(def)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${def.name}`}
                style={[s.row, i !== defs.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowLabel, { color: colors.foreground }]}>{def.name}</Text>
                  <Text style={[s.rowMeta, { color: colors.mutedForeground }]}>
                    {def.namespace}.{def.key} · {metafieldTypeLabel(def.type)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => togglePinned(def)} hitSlop={8} accessibilityLabel={def.pinned ? 'Unpin field' : 'Pin field'}>
                  <Feather name="bookmark" size={16} color={def.pinned ? colors.foreground : colors.mutedForeground} />
                </TouchableOpacity>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 10 }} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.modalWrap, { backgroundColor: `${colors.background}CC` }]}>
          <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, SP.md) + 20 }]}>
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>{editing ? 'Edit field' : 'New field'}</Text>

            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Name</Text>
            <TextInput
              style={inputStyle}
              value={draft.name}
              onChangeText={(name) => setDraft((d) => ({ ...d, name, key: keyTouched ? d.key : keyFromName(name) }))}
              placeholder="Care instructions"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Key</Text>
            <TextInput
              style={[inputStyle, !!editing && { opacity: 0.6 }]}
              value={draft.key}
              editable={!editing}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(key) => { setKeyTouched(true); setDraft((d) => ({ ...d, key })); }}
              placeholder="care_instructions"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
            <View style={s.typeWrap}>
              {METAFIELD_TYPE_OPTIONS.map((t) => {
                const active = draft.type === t.value;
                return (
                  <TouchableOpacity
                    key={t.value}
                    onPress={() => setDraft((d) => ({ ...d, type: t.value }))}
                    style={[s.typeChip, { borderColor: active ? colors.foreground : colors.border, backgroundColor: active ? colors.secondary : 'transparent' }]}
                  >
                    <Text style={[s.typeChipText, { color: active ? colors.foreground : colors.mutedForeground }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Description (optional)</Text>
            <TextInput
              style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
              value={draft.description}
              onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
              multiline
              placeholder="Shown to your team when filling this in"
              placeholderTextColor={colors.mutedForeground}
            />

            <View style={s.sheetActions}>
              {editing && (
                <TouchableOpacity onPress={() => confirmDelete(editing)} style={s.deleteBtn}>
                  <Feather name="trash-2" size={14} color={colors.destructive} />
                  <Text style={[s.deleteText, { color: colors.destructive }]}>Delete</Text>
                </TouchableOpacity>
              )}
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setFormOpen(false)} style={[s.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={[s.secondaryBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={save} disabled={saving} style={[s.primaryBtn, { backgroundColor: colors.primary, marginTop: 0, opacity: saving ? 0.7 : 1 }]}>
                {saving
                  ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                  : <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', paddingVertical: 40, gap: SP.sm },
  emptyTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
  emptyText: { fontSize: FS.xs, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: SP.lg },
  listCard: { borderRadius: RADIUS.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  rowLabel: { fontSize: 14, fontFamily: FONT.semibold },
  rowMeta: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, borderWidth: 1, padding: 20 },
  sheetTitle: { fontSize: FS.md, fontFamily: FONT.bold, marginBottom: SP.sm },
  fieldLabel: { fontSize: 12, fontFamily: FONT.medium, marginTop: SP.md, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: FONT.regular },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 6 },
  typeChipText: { fontSize: 12, fontFamily: FONT.medium },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SP.lg },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  primaryBtn: { borderRadius: RADIUS.sm, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', marginTop: SP.sm },
  primaryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  secondaryBtn: { borderRadius: RADIUS.sm, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  secondaryBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});

import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import * as ImagePicker from 'expo-image-picker';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Switch, Modal, Image, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/layout';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard,
} from '@/components/BrandthreadUI';
import {
  getCollections, createCollection, updateCollection, deleteCollection,
  getStorefront,
} from '@/services/storeService';
import { useApi } from '@/lib/api';
import {
  StoreCollection, CollectionType, CollectionStatus,
  CollectionCondition, CollectionConditionField, CollectionConditionOperator,
} from '@/services/storeTypes';

type Mode = 'list' | 'edit' | 'new';

const PRODUCT_ORDER_OPTIONS: { value: StoreCollection['productOrder']; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'newest', label: 'Newest' },
  { value: 'best_selling', label: 'Best Selling' },
  { value: 'title_asc', label: 'Title A→Z' },
  { value: 'title_desc', label: 'Title Z→A' },
  { value: 'price_asc', label: 'Price Low→High' },
  { value: 'price_desc', label: 'Price High→Low' },
];

const CONDITION_FIELDS: { value: CollectionConditionField; label: string }[] = [
  { value: 'tag', label: 'Tag' },
  { value: 'category', label: 'Category' },
  { value: 'price', label: 'Price' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'product_type', label: 'Type' },
  { value: 'pre_order', label: 'Pre-order' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'new_products', label: 'New Products' },
];

const CONDITION_OPERATORS: { value: CollectionConditionOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'less_than', label: 'Less than' },
  { value: 'is_set', label: 'Is set' },
];

function statusVariant(status: CollectionStatus): 'success' | 'info' | 'warning' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'draft') return 'info';
  if (status === 'scheduled') return 'warning';
  return 'neutral';
}

function toHandle(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface FormState {
  type: CollectionType;
  name: string;
  description: string;
  productOrder: StoreCollection['productOrder'];
  conditionMatch: 'all' | 'any';
  conditions: CollectionCondition[];
  seoTitle: string;
  seoDescription: string;
  handle: string;
  status: CollectionStatus;
  scheduledAt: string;
  seoExpanded: boolean;
  coverImage?: string;
}

function defaultForm(): FormState {
  return {
    type: 'manual',
    name: '',
    description: '',
    productOrder: 'manual',
    conditionMatch: 'all',
    conditions: [],
    seoTitle: '',
    seoDescription: '',
    handle: '',
    status: 'draft',
    scheduledAt: '',
    seoExpanded: false,
  };
}

export default function StoreCollectionsScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('list');
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<StoreCollection | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const api = useApi();

  useFocusEffect(
    useCallback(() => {
      loadCollections();
    }, [])
  );

  async function loadCollections() {
    try {
      const cols = await getCollections();
      setCollections(cols);
    } catch {
      setCollections([]);
    }
  }

  function openNew() {
    setSelectedCollection(null);
    setForm(defaultForm());
    setMode('new');
  }

  function openEdit(col: StoreCollection) {
    setSelectedCollection(col);
    setForm({
      type: col.type,
      name: col.name,
      description: col.description,
      productOrder: col.productOrder,
      conditionMatch: col.conditionMatch,
      conditions: col.conditions ? [...col.conditions] : [],
      seoTitle: col.seoTitle ?? '',
      seoDescription: col.seoDescription ?? '',
      handle: col.handle,
      status: col.status,
      scheduledAt: col.scheduledAt ?? '',
      seoExpanded: false,
    });
    setMode('edit');
  }

  function handleDelete(col: StoreCollection) {
    Alert.alert(
      'Delete Collection',
      `Delete "${col.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deleteCollection(col.id);
              await loadCollections();
            } catch {
              Alert.alert('Error', 'Failed to delete collection.');
            }
          },
        },
      ]
    );
  }

  async function handleSave() {
    if (!form.name.trim()) {
      Alert.alert('Name required', 'Please enter a collection name.');
      return;
    }
    setSaving(true);
    try {
      const data: Partial<StoreCollection> = {
        type: form.type,
        name: form.name.trim(),
        description: form.description,
        productOrder: form.productOrder,
        conditionMatch: form.conditionMatch,
        conditions: form.conditions,
        seoTitle: form.seoTitle || undefined,
        seoDescription: form.seoDescription || undefined,
        handle: form.handle || toHandle(form.name),
        status: form.status,
        scheduledAt: form.status === 'scheduled' ? form.scheduledAt : undefined,
      };
      if (mode === 'edit' && selectedCollection) {
        await updateCollection(selectedCollection.id, data);
      } else {
        await createCollection(data);
      }
      await loadCollections();
      setMode('list');
    } catch {
      Alert.alert('Error', 'Failed to save collection.');
    } finally {
      setSaving(false);
    }
  }

  function setFormField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !prev.handle) {
        (next as any).handle = toHandle(value as string);
      }
      return next;
    });
  }

  function addCondition() {
    setForm((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: 'tag', operator: 'equals', value: '' }],
    }));
  }

  function removeCondition(idx: number) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== idx),
    }));
  }

  function updateCondition(idx: number, patch: Partial<CollectionCondition>) {
    setForm((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => i === idx ? { ...c, ...patch } : c),
    }));
  }

  // ─── List Mode ───────────────────────────────────────────────────────────────

  if (mode === 'list') {
    return (
      <View style={styles.root}>
        <Header
          title="Collections"
          actions={[{ icon: 'plus', onPress: openNew, accessibilityLabel: 'Create collection' }]}
        />

        {collections.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="grid"
              title="No collections yet"
              description="Group products into collections. Buyers can shop by category, style, or any criteria you choose."
              action={{ label: '+ Create Collection', onPress: openNew, icon: 'plus' }}
            />
          </View>
        ) : (
          <FlatList
            data={collections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + SP.xl }]}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <BrandthreadCard style={styles.collectionCard}>
                <View style={styles.colRow}>
                  <View style={styles.colInfo}>
                    <View style={styles.colTitleRow}>
                      <Text style={styles.colName} numberOfLines={1}>{item.name}</Text>
                      <StatusBadge
                        label={item.type === 'automated' ? 'Automated' : 'Manual'}
                        variant={item.type === 'automated' ? 'info' : 'purple'}
                        small
                      />
                      <StatusBadge
                        label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        variant={statusVariant(item.status)}
                        small
                      />
                    </View>
                    <Text style={styles.colMeta}>
                      {item.productIds.length} products · /{item.handle}
                    </Text>
                  </View>
                </View>
                <View style={styles.colActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                    <Feather name="edit-2" size={ICON.xs} color={PURPLE} />
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => handleDelete(item)}>
                    <Feather name="trash-2" size={ICON.xs} color={RED} />
                    <Text style={[styles.actionBtnText, { color: RED }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </BrandthreadCard>
            )}
          />
        )}
      </View>
    );
  }

  // ─── New / Edit Mode ─────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        title={mode === 'new' ? 'New Collection' : 'Edit Collection'}
        onBack={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('list'); }}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + SP.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Type */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.chipRow}>
            {(['manual', 'automated'] as CollectionType[]).map((t) => (
              <FilterChip
                key={t}
                label={t.charAt(0).toUpperCase() + t.slice(1)}
                active={form.type === t}
                onPress={() => setFormField('type', t)}
              />
            ))}
          </View>
        </View>

        {/* 2. Name */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Name *</Text>
          <TextInput
            style={styles.textInput}
            value={form.name}
            onChangeText={(v) => setFormField('name', v)}
            placeholder="e.g. Summer Collection"
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* 3. Description */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.textInput, styles.multilineInput]}
            value={form.description}
            onChangeText={(v) => setFormField('description', v)}
            placeholder="Describe this collection…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* 4. Cover Image */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Cover Image</Text>
          <View style={styles.coverPlaceholder}>
            {coverUploading ? (
              <ActivityIndicator color={PURPLE} />
            ) : form.coverImage ? (
              <Image source={{ uri: form.coverImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <>
                <Feather name="image" size={ICON.lg} color={MUTED} />
                <Text style={styles.coverPlaceholderText}>No cover image</Text>
              </>
            )}
          </View>
          <TouchableOpacity
            style={styles.uploadBtn}
            disabled={coverUploading}
            onPress={async () => {
              const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!perm.granted) { Alert.alert('Permission required', 'Allow access to your photo library.'); return; }
              const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, aspect: [16, 9], allowsEditing: true });
              if (result.canceled || !result.assets[0]) return;
              setCoverUploading(true);
              try {
                const uploaded = await api.products.uploadImage({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType });
                const remoteUri = (uploaded as any)?.objectPath || result.assets[0].uri;
                setForm(prev => ({ ...prev, coverImage: remoteUri }));
              } catch {
                Alert.alert("Couldn't upload cover", 'Try again.');
              } finally {
                setCoverUploading(false);
              }
            }}
          >
            <Feather name="upload" size={ICON.sm} color={PURPLE} />
            <Text style={styles.uploadBtnText}>{form.coverImage ? 'Change cover' : 'Upload Cover'}</Text>
          </TouchableOpacity>
        </View>

        {/* 5. Product Order (Manual) */}
        {form.type === 'manual' && (
          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>Product Order</Text>
            <View style={styles.chipRow}>
              {PRODUCT_ORDER_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.value}
                  label={opt.label}
                  active={form.productOrder === opt.value}
                  onPress={() => setFormField('productOrder', opt.value)}
                />
              ))}
            </View>
          </View>
        )}

        {/* 6. Automated Conditions */}
        {form.type === 'automated' && (
          <View style={styles.formSection}>
            <Text style={styles.fieldLabel}>Products matching:</Text>
            <View style={styles.chipRow}>
              <FilterChip
                label="All conditions"
                active={form.conditionMatch === 'all'}
                onPress={() => setFormField('conditionMatch', 'all')}
              />
              <FilterChip
                label="Any condition"
                active={form.conditionMatch === 'any'}
                onPress={() => setFormField('conditionMatch', 'any')}
              />
            </View>
            {form.conditions.map((cond, idx) => (
              <View key={idx} style={styles.conditionRow}>
                <View style={styles.conditionFields}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.chipRow}>
                      {CONDITION_FIELDS.map((f) => (
                        <FilterChip
                          key={f.value}
                          label={f.label}
                          active={cond.field === f.value}
                          onPress={() => updateCondition(idx, { field: f.value })}
                        />
                      ))}
                    </View>
                  </ScrollView>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.chipRow}>
                      {CONDITION_OPERATORS.map((op) => (
                        <FilterChip
                          key={op.value}
                          label={op.label}
                          active={cond.operator === op.value}
                          onPress={() => updateCondition(idx, { operator: op.value })}
                        />
                      ))}
                    </View>
                  </ScrollView>
                  <TextInput
                    style={styles.textInput}
                    value={cond.value}
                    onChangeText={(v) => updateCondition(idx, { value: v })}
                    placeholder="Value"
                    placeholderTextColor={SUBTLE}
                  />
                </View>
                <TouchableOpacity
                  onPress={() => removeCondition(idx)}
                  style={styles.removeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={ICON.sm} color={RED} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addConditionBtn} onPress={addCondition}>
              <Feather name="plus" size={ICON.sm} color={PURPLE} />
              <Text style={styles.addConditionText}>+ Add Condition</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 7. SEO */}
        <View style={styles.formSection}>
          <TouchableOpacity
            style={styles.seoToggle}
            onPress={() => setFormField('seoExpanded', !form.seoExpanded)}
          >
            <Text style={styles.fieldLabel}>SEO</Text>
            <Feather
              name={form.seoExpanded ? 'chevron-up' : 'chevron-down'}
              size={ICON.sm}
              color={MUTED}
            />
          </TouchableOpacity>
          {form.seoExpanded && (
            <>
              <Text style={styles.subLabel}>SEO Title</Text>
              <TextInput
                style={styles.textInput}
                value={form.seoTitle}
                onChangeText={(v) => setFormField('seoTitle', v)}
                placeholder="SEO title"
                placeholderTextColor={SUBTLE}
              />
              <Text style={[styles.subLabel, { marginTop: SP.sm }]}>SEO Description</Text>
              <TextInput
                style={[styles.textInput, styles.multilineInput]}
                value={form.seoDescription}
                onChangeText={(v) => setFormField('seoDescription', v)}
                placeholder="SEO description"
                placeholderTextColor={SUBTLE}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
              <Text style={[styles.subLabel, { marginTop: SP.sm }]}>URL Handle</Text>
              <TextInput
                style={styles.textInput}
                value={form.handle}
                onChangeText={(v) => setFormField('handle', v)}
                placeholder="my-collection"
                placeholderTextColor={SUBTLE}
                autoCapitalize="none"
              />
            </>
          )}
        </View>

        {/* 8. Status */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.chipRow}>
            {(['active', 'draft', 'hidden', 'scheduled'] as CollectionStatus[]).map((s) => (
              <FilterChip
                key={s}
                label={s.charAt(0).toUpperCase() + s.slice(1)}
                active={form.status === s}
                onPress={() => setFormField('status', s)}
              />
            ))}
          </View>
          {form.status === 'scheduled' && (
            <>
              <Text style={[styles.subLabel, { marginTop: SP.sm }]}>Schedule Date</Text>
              <TextInput
                style={styles.textInput}
                value={form.scheduledAt}
                onChangeText={(v) => setFormField('scheduledAt', v)}
                placeholder="Jul 21, 2026"
                placeholderTextColor={SUBTLE}
              />
            </>
          )}
        </View>

        {/* 9. Save */}
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save Collection'}
          onPress={handleSave}
          disabled={saving}
          style={styles.saveBtn}
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  const BORDER_ACTIVE = theme.accentLight;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  collectionCard: {
    gap: SP.sm,
  },
  colRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  colInfo: {
    flex: 1,
    gap: 4,
  },
  colTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  colName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    flex: 1,
  },
  colMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  colActions: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    paddingHorizontal: SP.sm,
    paddingVertical: 5,
  },
  actionBtnDanger: {
    backgroundColor: RED_DIM,
    borderColor: RED,
  },
  actionBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  formContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.md,
  },
  formSection: {
    gap: SP.sm,
  },
  fieldLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
    letterSpacing: 0.2,
  },
  subLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  textInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    minHeight: 48,
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: SP.sm,
  },
  coverPlaceholder: {
    height: 120,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
    overflow: 'hidden',
  },
  coverPlaceholderText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    alignSelf: 'flex-start',
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  uploadBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
  },
  conditionFields: {
    flex: 1,
    gap: SP.xs,
  },
  removeBtn: {
    paddingTop: SP.xs,
  },
  addConditionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    alignSelf: 'flex-start',
    paddingVertical: SP.sm,
  },
  addConditionText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  seoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  saveBtn: {
    marginTop: SP.sm,
  },
  });
};

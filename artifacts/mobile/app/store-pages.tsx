import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '@/components/layout';
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
import { getPages, createPage, updatePage, duplicatePage, deletePage } from '@/services/storeService';
import { StorePage, PageType, PageStatus } from '@/services/storeTypes';

type Mode = 'list' | 'edit' | 'new';

const PAGE_TYPES: { value: PageType; label: string }[] = [
  { value: 'about', label: 'About' },
  { value: 'contact', label: 'Contact' },
  { value: 'faq', label: 'FAQ' },
  { value: 'size_guide', label: 'Size Guide' },
  { value: 'shipping_policy', label: 'Shipping Policy' },
  { value: 'return_policy', label: 'Return Policy' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
  { value: 'terms', label: 'Terms' },
  { value: 'custom', label: 'Custom Page' },
];

const POLICY_TYPES: PageType[] = ['shipping_policy', 'return_policy', 'privacy_policy', 'terms'];

function statusVariant(status: PageStatus): 'success' | 'info' | 'warning' | 'neutral' {
  if (status === 'published') return 'success';
  if (status === 'draft') return 'info';
  if (status === 'scheduled') return 'warning';
  return 'neutral';
}

function statusLabel(status: PageStatus): string {
  if (status === 'published') return 'Published';
  if (status === 'draft') return 'Draft';
  if (status === 'scheduled') return 'Scheduled';
  return 'Hidden';
}

function toSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface FormState {
  type: PageType;
  title: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  slug: string;
  status: PageStatus;
  scheduledAt: string;
  seoExpanded: boolean;
}

function defaultForm(): FormState {
  return {
    type: 'custom',
    title: '',
    content: '',
    seoTitle: '',
    seoDescription: '',
    slug: '',
    status: 'draft',
    scheduledAt: '',
    seoExpanded: false,
  };
}

export default function StorePagesScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('list');
  const [pages, setPages] = useState<StorePage[]>([]);
  const [selectedPage, setSelectedPage] = useState<StorePage | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadPages();
    }, [])
  );

  async function loadPages() {
    try {
      const result = await getPages();
      setPages(result);
    } catch {
      setPages([]);
    }
  }

  function openNew() {
    setSelectedPage(null);
    setForm(defaultForm());
    setMode('new');
  }

  function openEdit(page: StorePage) {
    setSelectedPage(page);
    setForm({
      type: page.type,
      title: page.title,
      content: page.content,
      seoTitle: page.seoTitle ?? '',
      seoDescription: page.seoDescription ?? '',
      slug: page.slug,
      status: page.status,
      scheduledAt: page.scheduledAt ?? '',
      seoExpanded: false,
    });
    setMode('edit');
  }

  function handleDelete(page: StorePage) {
    Alert.alert(
      'Delete Page',
      `Delete "${page.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deletePage(page.id);
              await loadPages();
            } catch {
              Alert.alert('Error', 'Failed to delete page.');
            }
          },
        },
      ]
    );
  }

  async function handleDuplicate(page: StorePage) {
    try {
      await duplicatePage(page.id);
      await loadPages();
    } catch {
      Alert.alert('Error', 'Failed to duplicate page.');
    }
  }

  async function handleSave() {
    if (!form.title.trim()) {
      Alert.alert('Title required', 'Please enter a page title.');
      return;
    }
    setSaving(true);
    try {
      const data: Partial<StorePage> = {
        type: form.type,
        title: form.title.trim(),
        content: form.content,
        seoTitle: form.seoTitle || undefined,
        seoDescription: form.seoDescription || undefined,
        slug: form.slug || toSlug(form.title),
        status: form.status,
        scheduledAt: form.status === 'scheduled' ? form.scheduledAt : undefined,
      };
      if (mode === 'edit' && selectedPage) {
        await updatePage(selectedPage.id, data);
      } else {
        await createPage(data);
      }
      await loadPages();
      setMode('list');
    } catch {
      Alert.alert('Error', 'Failed to save page.');
    } finally {
      setSaving(false);
    }
  }

  function setFormField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !prev.slug) {
        (next as any).slug = toSlug(value as string);
      }
      return next;
    });
  }

  // ─── List Mode ───────────────────────────────────────────────────────────────

  if (mode === 'list') {
    return (
      <View style={styles.root}>
        <Header
          title="Pages"
          actions={[{ icon: 'plus', onPress: openNew, accessibilityLabel: 'Create page' }]}
        />

        {pages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="file-text"
              title="No pages yet"
              description="Create pages that explain your brand and policies."
              action={{ label: 'Create Page', onPress: openNew, icon: 'plus' }}
            />
          </View>
        ) : (
          <FlatList
            data={pages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + SP.xl }]}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <BrandthreadCard style={styles.pageCard}>
                <View style={styles.pageHeader}>
                  <View style={styles.pageTitleRow}>
                    <Text style={styles.pageTitle} numberOfLines={1}>{item.title}</Text>
                    <StatusBadge
                      label={PAGE_TYPES.find(t => t.value === item.type)?.label ?? item.type}
                      variant="purple"
                      small
                    />
                    <StatusBadge
                      label={statusLabel(item.status)}
                      variant={statusVariant(item.status)}
                      small
                    />
                  </View>
                  <Text style={styles.pageSlug}>/{item.slug}</Text>
                </View>
                <View style={styles.pageActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                    <Feather name="edit-2" size={ICON.xs} color={PURPLE} />
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleDuplicate(item)}>
                    <Feather name="copy" size={ICON.xs} color={PURPLE} />
                    <Text style={styles.actionBtnText}>Duplicate</Text>
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
        title={mode === 'new' ? 'New Page' : 'Edit Page'}
        onBack={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('list'); }}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + SP.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Type picker */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Page Type</Text>
          <View style={styles.typeGrid}>
            {PAGE_TYPES.map((pt) => (
              <TouchableOpacity
                key={pt.value}
                style={[styles.typeChip, form.type === pt.value && styles.typeChipActive]}
                onPress={() => setFormField('type', pt.value)}
              >
                <Text style={[styles.typeChipText, form.type === pt.value && styles.typeChipTextActive]}>
                  {pt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 2. Title */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.textInput}
            value={form.title}
            onChangeText={(v) => setFormField('title', v)}
            placeholder="Page title"
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* 3. Content */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Content</Text>
          {POLICY_TYPES.includes(form.type) && (
            <Text style={styles.policyNote}>
              Pages created here are separate from your Policy settings.
            </Text>
          )}
          <TextInput
            style={[styles.textInput, styles.contentInput]}
            value={form.content}
            onChangeText={(v) => setFormField('content', v)}
            placeholder="Write your page content here…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
          />
        </View>

        {/* 4. SEO */}
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
            </>
          )}
        </View>

        {/* 5. URL Slug */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>URL</Text>
          <TextInput
            style={styles.textInput}
            value={form.slug}
            onChangeText={(v) => setFormField('slug', v)}
            placeholder="my-page"
            placeholderTextColor={SUBTLE}
            autoCapitalize="none"
          />
        </View>

        {/* 6. Status */}
        <View style={styles.formSection}>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.chipRow}>
            {(['published', 'draft', 'hidden', 'scheduled'] as PageStatus[]).map((s) => (
              <FilterChip
                key={s}
                label={statusLabel(s)}
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

        {/* 7. Save */}
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save Page'}
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
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const BORDER_ACTIVE = theme.accentLight;
  const BG = theme.background;
  const SURFACE = theme.surface;
  const CARD = theme.card;
  const CARD_ELEVATED = theme.cardElevated;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const SUCCESS = theme.success;
  const SUCCESS_DIM = `${theme.success}20`;
  const ORANGE = theme.warning;
  const ORANGE_DIM = `${theme.warning}20`;
  const RED = theme.error;
  const RED_DIM = `${theme.error}20`;
  const BLUE = theme.accent;
  const BLUE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const CYAN_DIM = theme.secondaryDim;
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
  pageCard: {
    gap: SP.sm,
  },
  pageHeader: {
    gap: 4,
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  pageTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    flex: 1,
  },
  pageSlug: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  pageActions: {
    flexDirection: 'row',
    gap: SP.sm,
    flexWrap: 'wrap',
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
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  typeChip: {
    paddingHorizontal: SP.sm,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  typeChipActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  typeChipText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  typeChipTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  policyNote: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: ORANGE,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
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
  contentInput: {
    minHeight: 200,
    textAlignVertical: 'top',
    paddingTop: SP.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
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

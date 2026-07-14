import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, Switch,
  StyleSheet, Alert, TouchableOpacity,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import {
  BG, SURFACE, CARD, BORDER,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SectionHeader } from '@/components/BrandthreadUI';
import { getStorefront, updateSEO } from '@/services/storeService';
import { Storefront, StoreSEO } from '@/services/storeTypes';

export default function StoreSEOScreen() {
  const router = useRouter();
  const [store, setStore] = useState<Storefront | null>(null);
  const [seo, setSeo] = useState<StoreSEO>({
    homepageTitle: '',
    homepageDescription: '',
    sitemapEnabled: true,
    searchVisible: false,
    productSeoDefaults: { titleTemplate: '{{product}} – {{store}}', descriptionTemplate: '{{description}}' },
    collectionSeoDefaults: { titleTemplate: '{{collection}} – {{store}}', descriptionTemplate: '{{description}}' },
  });
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    getStorefront().then(s => {
      setStore(s);
      setSeo(s.seo);
    });
  }, []));

  const patch = (partial: Partial<StoreSEO>) => setSeo(s => ({ ...s, ...partial }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSEO(seo);
      Alert.alert('Saved', 'SEO settings updated.');
    } catch {
      Alert.alert('Error', 'Failed to save SEO settings.');
    } finally {
      setSaving(false);
    }
  };

  const storeUrl = store?.settings.storeUrl ?? 'yourstore';

  return (
    <View style={se.root}>
      <View style={se.header}>
        <TouchableOpacity onPress={() => router.back()} style={se.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={se.headerTitle}>SEO</Text>
        <PrimaryButton label={saving ? 'Saving...' : 'Save'} onPress={handleSave} loading={saving} small style={{ minWidth: 72 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={se.scroll}>

        {/* HOMEPAGE SEO */}
        <SectionHeader title="HOMEPAGE SEO" style={se.sh} />
        <BrandthreadCard style={se.card}>
          <View style={se.fieldRow}>
            <View style={se.labelRow}>
              <Text style={se.fieldLabel}>Homepage Title</Text>
              <Text style={[se.charCount, { color: seo.homepageTitle.length > 60 ? RED : MUTED }]}>
                {seo.homepageTitle.length}/60
              </Text>
            </View>
            <TextInput
              style={se.input}
              value={seo.homepageTitle}
              onChangeText={v => patch({ homepageTitle: v.slice(0, 60) })}
              placeholder="Your Store – Shop Now"
              placeholderTextColor={SUBTLE}
            />
          </View>
          <View style={se.divider} />
          <View style={se.fieldRow}>
            <View style={se.labelRow}>
              <Text style={se.fieldLabel}>Homepage Description</Text>
              <Text style={[se.charCount, { color: seo.homepageDescription.length > 160 ? RED : MUTED }]}>
                {seo.homepageDescription.length}/160
              </Text>
            </View>
            <TextInput
              style={[se.input, se.multiline]}
              value={seo.homepageDescription}
              onChangeText={v => patch({ homepageDescription: v.slice(0, 160) })}
              placeholder="Describe your store for search engines..."
              placeholderTextColor={SUBTLE}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
          <View style={se.divider} />
          <TouchableOpacity style={se.uploadBtn}>
            <Feather name="image" size={ICON.sm} color={MUTED} />
            <Text style={se.uploadBtnText}>Upload Social Image</Text>
          </TouchableOpacity>
        </BrandthreadCard>

        {/* GOOGLE PREVIEW */}
        <SectionHeader title="GOOGLE PREVIEW" style={se.sh} />
        <BrandthreadCard style={[se.card, { backgroundColor: SURFACE }]}>
          <Text style={se.previewTitle} numberOfLines={1}>
            {seo.homepageTitle || 'Your Store Name'}
          </Text>
          <Text style={se.previewUrl}>brandthread.co/{storeUrl}</Text>
          <Text style={se.previewDesc} numberOfLines={2}>
            {seo.homepageDescription || 'Add a description to appear in search results...'}
          </Text>
        </BrandthreadCard>

        {/* SEARCH */}
        <SectionHeader title="SEARCH" style={se.sh} />
        <BrandthreadCard style={se.card}>
          <View style={se.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={se.switchLabel}>Sitemap Enabled</Text>
              <Text style={se.switchDesc}>Include store in search sitemaps</Text>
            </View>
            <Switch
              value={seo.sitemapEnabled}
              onValueChange={v => patch({ sitemapEnabled: v })}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: PURPLE }}
              thumbColor={FG}
            />
          </View>
          <View style={se.divider} />
          <View style={se.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={se.switchLabel}>Search Visible</Text>
              <Text style={se.switchDesc}>Allow search engines to index your store</Text>
            </View>
            <Switch
              value={seo.searchVisible}
              onValueChange={v => patch({ searchVisible: v })}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: PURPLE }}
              thumbColor={FG}
            />
          </View>
          {!seo.searchVisible && (
            <View style={[se.warnBanner, { backgroundColor: RED_DIM, borderColor: RED }]}>
              <Feather name="alert-circle" size={ICON.sm} color={RED} />
              <Text style={[se.warnText, { color: RED }]}>Your store won't appear in search results.</Text>
            </View>
          )}
        </BrandthreadCard>

        {/* PRODUCT DEFAULTS */}
        <SectionHeader title="PRODUCT DEFAULTS" style={se.sh} />
        <BrandthreadCard style={se.card}>
          <View style={se.fieldRow}>
            <Text style={se.fieldLabel}>Title Template</Text>
            <TextInput
              style={se.input}
              value={seo.productSeoDefaults.titleTemplate}
              onChangeText={v => patch({ productSeoDefaults: { ...seo.productSeoDefaults, titleTemplate: v } })}
              placeholder="Use {{product}} and {{store}}"
              placeholderTextColor={SUBTLE}
            />
            <Text style={se.hint}>Use {'{{product}}'} and {'{{store}}'}</Text>
          </View>
          <View style={se.divider} />
          <View style={se.fieldRow}>
            <Text style={se.fieldLabel}>Description Template</Text>
            <TextInput
              style={[se.input, se.multiline]}
              value={seo.productSeoDefaults.descriptionTemplate}
              onChangeText={v => patch({ productSeoDefaults: { ...seo.productSeoDefaults, descriptionTemplate: v } })}
              placeholder="Use {{description}}"
              placeholderTextColor={SUBTLE}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <Text style={se.hint}>Use {'{{description}}'}</Text>
          </View>
        </BrandthreadCard>

        {/* COLLECTION DEFAULTS */}
        <SectionHeader title="COLLECTION DEFAULTS" style={se.sh} />
        <BrandthreadCard style={se.card}>
          <View style={se.fieldRow}>
            <Text style={se.fieldLabel}>Title Template</Text>
            <TextInput
              style={se.input}
              value={seo.collectionSeoDefaults.titleTemplate}
              onChangeText={v => patch({ collectionSeoDefaults: { ...seo.collectionSeoDefaults, titleTemplate: v } })}
              placeholder="{{collection}} – {{store}}"
              placeholderTextColor={SUBTLE}
            />
          </View>
          <View style={se.divider} />
          <View style={se.fieldRow}>
            <Text style={se.fieldLabel}>Description Template</Text>
            <TextInput
              style={[se.input, se.multiline]}
              value={seo.collectionSeoDefaults.descriptionTemplate}
              onChangeText={v => patch({ collectionSeoDefaults: { ...seo.collectionSeoDefaults, descriptionTemplate: v } })}
              placeholder="{{description}}"
              placeholderTextColor={SUBTLE}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>
        </BrandthreadCard>

        <PrimaryButton label="Save SEO" onPress={handleSave} loading={saving} style={se.saveBtn} />
      </ScrollView>
    </View>
  );
}

const se = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, flex: 1, marginLeft: SP.sm },
  scroll: { paddingBottom: 60 },
  sh: { marginTop: SP.lg, marginBottom: SP.sm },
  card: { marginHorizontal: SP.md, gap: SP.md },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  fieldRow: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  charCount: { fontSize: FS.xs, fontFamily: FONT.medium },
  hint: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 4 },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  multiline: { minHeight: 72, paddingTop: 10 },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderStyle: 'dashed',
    borderRadius: RADIUS.sm, padding: SP.md,
  },
  uploadBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  previewTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: '#4285F4' },
  previewUrl: { fontSize: FS.sm, fontFamily: FONT.regular, color: '#34A853', marginTop: 2 },
  previewDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 4, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  switchDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.sm,
  },
  warnText: { fontSize: FS.sm, fontFamily: FONT.medium, flex: 1 },
  saveBtn: { marginHorizontal: SP.md, marginTop: SP.lg },
});

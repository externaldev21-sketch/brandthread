import React, { useState } from 'react';
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, Alert, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, ORANGE, ORANGE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, FilterChip } from '@/components/BrandthreadUI';

type TabMode = 'upload' | 'posts' | 'url';

const FAKE_POSTS = [
  { id: 'p1', title: 'New Drop — Summer Collection', desc: 'Product showcase post', selected: false },
  { id: 'p2', title: 'Behind the Scenes', desc: 'Brand story video', selected: false },
  { id: 'p3', title: 'Customer Feature', desc: 'Community highlight', selected: false },
];

export default function StoreFromSocialScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabMode>('upload');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [profileUrl, setProfileUrl] = useState('');
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);

  const addScreenshots = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 0.8,
    });
    if (!res.canceled && res.assets.length > 0) {
      setScreenshots(prev => [...prev, ...res.assets.map(a => a.uri)].slice(0, 12));
    }
  };

  const removeScreenshot = (idx: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== idx));
  };

  const togglePost = (id: string) => {
    setSelectedPostIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleAnalyzeScreenshots = () => {
    Alert.alert(
      'Screenshot Analysis',
      'Screenshot analysis coming soon. Using uploaded content to suggest your color palette.',
      [{ text: 'OK', onPress: () => router.push('/store-from-moodboard' as never) }],
    );
  };

  const handleGenerateFromPosts = () => {
    router.push('/store-editor' as never);
    Alert.alert('Store Generated', 'Store generated from your Seller content.');
  };

  const tabs: { value: TabMode; label: string }[] = [
    { value: 'upload', label: 'Upload Screenshots' },
    { value: 'posts', label: 'Use Seller Posts' },
    { value: 'url', label: 'Enter Profile URL' },
  ];

  return (
    <View style={sc.root}>
      <View style={sc.header}>
        <TouchableOpacity onPress={() => router.back()} style={sc.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={sc.headerTitle}>Generate from Social Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={sc.scroll}>
        <Text style={sc.subtitle}>Build your storefront from your social identity.</Text>

        {/* Important Notice */}
        <BrandthreadCard style={[sc.card, { borderColor: ORANGE, backgroundColor: ORANGE_DIM }]}>
          <View style={sc.bannerRow}>
            <Feather name="alert-triangle" size={ICON.sm} color={ORANGE} />
            <Text style={[sc.bannerText, { color: ORANGE }]}>
              No social platform scraping. This tool works with content you upload or select from your existing Seller posts. Direct social API access is not available in this version.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Tab Selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sc.tabScroll} contentContainerStyle={sc.tabRow}>
          {tabs.map(tab => (
            <FilterChip
              key={tab.value}
              label={tab.label}
              active={activeTab === tab.value}
              onPress={() => setActiveTab(tab.value)}
            />
          ))}
        </ScrollView>

        {/* TAB: UPLOAD SCREENSHOTS */}
        {activeTab === 'upload' && (
          <BrandthreadCard style={sc.card}>
            <TouchableOpacity style={sc.uploadBox} onPress={addScreenshots} activeOpacity={0.7}>
              <Feather name="upload" size={ICON.xl} color={PURPLE} />
              <Text style={sc.uploadLabel}>Tap to upload screenshots</Text>
              <Text style={sc.uploadSub}>Up to 12 images</Text>
            </TouchableOpacity>

            {screenshots.length > 0 && (
              <View style={sc.thumbGrid}>
                {screenshots.map((uri, idx) => (
                  <View key={uri + idx} style={sc.thumbWrap}>
                    <Image source={{ uri }} style={sc.thumb} resizeMode="cover" />
                    <TouchableOpacity style={sc.removeBtn} onPress={() => removeScreenshot(idx)}>
                      <Feather name="x" size={12} color={FG} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {screenshots.length > 0 && (
              <PrimaryButton
                label="Analyze Screenshots"
                onPress={handleAnalyzeScreenshots}
                icon="zap"
              />
            )}
          </BrandthreadCard>
        )}

        {/* TAB: USE SELLER POSTS */}
        {activeTab === 'posts' && (
          <BrandthreadCard style={sc.card}>
            <Text style={sc.tabDesc}>Your published Seller posts will appear here.</Text>
            {FAKE_POSTS.map(post => (
              <TouchableOpacity
                key={post.id}
                style={[sc.postItem, selectedPostIds.includes(post.id) && sc.postItemActive]}
                onPress={() => togglePost(post.id)}
                activeOpacity={0.7}
              >
                <View style={sc.postCheck}>
                  {selectedPostIds.includes(post.id) && (
                    <Feather name="check" size={ICON.xs} color={PURPLE_LIGHT} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sc.postTitle}>{post.title}</Text>
                  <Text style={sc.postDesc}>{post.desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <PrimaryButton
              label="Generate from Selected Posts"
              onPress={handleGenerateFromPosts}
              disabled={selectedPostIds.length === 0}
              icon="zap"
              style={{ marginTop: SP.sm }}
            />
          </BrandthreadCard>
        )}

        {/* TAB: ENTER PROFILE URL */}
        {activeTab === 'url' && (
          <BrandthreadCard style={sc.card}>
            <Text style={sc.fieldLabel}>Profile URL</Text>
            <TextInput
              style={sc.input}
              value={profileUrl}
              onChangeText={setProfileUrl}
              placeholder="https://instagram.com/yourhandle"
              placeholderTextColor={SUBTLE}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Text style={sc.noteText}>
              Profile URL is for reference only. No content will be fetched automatically.
            </Text>
            <SecondaryButton
              label="Continue"
              onPress={() => setActiveTab('upload')}
              icon="arrow-right"
              style={{ marginTop: SP.sm }}
            />
          </BrandthreadCard>
        )}
      </ScrollView>
    </View>
  );
}

const sc = StyleSheet.create({
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
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, flex: 1 },
  scroll: { paddingBottom: 60, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  tabScroll: { marginBottom: SP.md },
  tabRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md },
  uploadBox: {
    borderWidth: 2, borderColor: PURPLE_DIM, borderStyle: 'dashed',
    borderRadius: RADIUS.md, padding: SP.xl,
    alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  uploadLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: MUTED },
  uploadSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 80, height: 80, borderRadius: RADIUS.sm },
  removeBtn: {
    position: 'absolute', top: 3, right: 3, width: 18, height: 18,
    borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  tabDesc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  postItem: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    padding: SP.md, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: SURFACE,
  },
  postItemActive: { borderColor: PURPLE_LIGHT, backgroundColor: PURPLE_DIM },
  postCheck: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1, borderColor: PURPLE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  postTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  postDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  noteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
});

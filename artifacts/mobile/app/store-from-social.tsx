import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Image, TouchableOpacity,
  StyleSheet, Alert, TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, SURFACE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { BrandthreadCard, PrimaryButton, SecondaryButton, FilterChip } from '@/components/BrandthreadUI';
import { generateFromSocial } from '@/services/storeService';
import { useApi } from '@/lib/api';

type TabMode = 'upload' | 'posts' | 'url';

interface SellerPost {
  id: string;
  title: string;
  desc: string;
}

const FALLBACK_POSTS: SellerPost[] = [
  { id: 'p1', title: 'New Drop — Summer Collection', desc: 'Product showcase post' },
  { id: 'p2', title: 'Behind the Scenes', desc: 'Brand story video' },
  { id: 'p3', title: 'Customer Feature', desc: 'Community highlight' },
];

export default function StoreFromSocialScreen() {
  const router = useRouter();
  const api = useApi();
  const [activeTab, setActiveTab] = useState<TabMode>('upload');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [screenshotBase64s, setScreenshotBase64s] = useState<string[]>([]);
  const [profileUrl, setProfileUrl] = useState('');
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [sellerPosts, setSellerPosts] = useState<SellerPost[]>(FALLBACK_POSTS);
  const [analyzing, setAnalyzing] = useState(false);

  // Load real seller posts
  useEffect(() => {
    (api as any).content?.myPosts?.().then((posts: any[]) => {
      if (Array.isArray(posts) && posts.length > 0) {
        setSellerPosts(posts.map((p: any) => ({
          id: String(p.id ?? p.postId ?? Math.random()),
          title: p.title ?? p.caption ?? 'Post',
          desc: p.type ?? 'Brand post',
        })));
      }
    }).catch(() => {/* use fallback */});
  }, [api]);

  const addScreenshots = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 12,
      quality: 0.7,
      base64: true,
    });
    if (!res.canceled && res.assets.length > 0) {
      setScreenshots(prev => [...prev, ...res.assets.map(a => a.uri)].slice(0, 12));
      setScreenshotBase64s(prev => [
        ...prev,
        ...res.assets.map(a => a.base64 ?? ''),
      ].slice(0, 12));
    }
  };

  const removeScreenshot = (idx: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== idx));
    setScreenshotBase64s(prev => prev.filter((_, i) => i !== idx));
  };

  const togglePost = (id: string) => {
    setSelectedPostIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleAnalyzeScreenshots = async () => {
    if (screenshots.length === 0) {
      Alert.alert('No screenshots', 'Add at least one screenshot to analyze.');
      return;
    }
    setAnalyzing(true);
    try {
      const validBase64s = screenshotBase64s.filter(Boolean);
      await generateFromSocial(
        profileUrl || 'social brand',
        validBase64s,
        { screenshotCount: screenshots.length },
      );
      router.push('/store-editor' as never);
    } catch {
      // Fall back: redirect to moodboard flow with the screenshots
      Alert.alert('Analysis failed', 'Could not analyze screenshots. Try the mood board flow instead.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateFromPosts = async () => {
    if (selectedPostIds.length === 0) {
      Alert.alert('No posts selected', 'Select at least one post to base your store on.');
      return;
    }
    setAnalyzing(true);
    try {
      const selected = sellerPosts.filter(p => selectedPostIds.includes(p.id));
      const context = selected.map(p => p.title).join(', ');
      await generateFromSocial(
        `brand whose posts include: ${context}`,
        undefined,
        { postCount: selected.length, postTitles: context },
      );
      router.push('/store-editor' as never);
    } catch {
      Alert.alert('Generation failed', 'Could not generate store from posts. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAnalyzeUrl = async () => {
    if (!profileUrl.trim()) {
      Alert.alert('Enter a URL', 'Paste your Instagram, TikTok, or website URL.');
      return;
    }
    setAnalyzing(true);
    try {
      await generateFromSocial(profileUrl.trim(), undefined, {});
      router.push('/store-editor' as never);
    } catch {
      Alert.alert('Could not analyze', 'Check your URL and try again. You can also upload screenshots instead.');
      setActiveTab('upload');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={ss.root}>
      <View style={ss.header}>
        <TouchableOpacity onPress={() => router.back()} style={ss.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={ss.headerTitle}>Generate from Social</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={ss.scroll}>
        <Text style={ss.subtitle}>
          Mirror your social brand identity. Import screenshots, pick posts, or paste your profile URL — AI builds the store.
        </Text>

        {/* AI badge */}
        <BrandthreadCard style={[ss.card, { borderColor: PURPLE_DIM, backgroundColor: 'rgba(124,58,237,0.08)' }]}>
          <View style={ss.bannerRow}>
            <Feather name="zap" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={[ss.bannerText, { color: PURPLE_LIGHT }]}>
              Powered by GPT-4o — screenshots are analyzed visually; URL and posts use brand context.
            </Text>
          </View>
        </BrandthreadCard>

        {/* Tab Switcher */}
        <View style={ss.tabRow}>
          {([['upload', 'Upload Screenshots'], ['posts', 'My Posts'], ['url', 'Social URL']] as [TabMode, string][]).map(([t, label]) => (
            <FilterChip key={t} label={label} active={activeTab === t} onPress={() => setActiveTab(t)} />
          ))}
        </View>

        {/* ─── Upload Tab ──────────────────────────────────────── */}
        {activeTab === 'upload' && (
          <>
            <View style={ss.grid}>
              {screenshots.map((uri, idx) => (
                <View key={uri + idx} style={ss.gridWrap}>
                  <Image source={{ uri }} style={ss.gridImg} resizeMode="cover" />
                  <TouchableOpacity style={ss.removeBtn} onPress={() => removeScreenshot(idx)}>
                    <Feather name="x" size={10} color={FG} />
                  </TouchableOpacity>
                </View>
              ))}
              {screenshots.length < 12 && (
                <TouchableOpacity style={ss.addTile} onPress={addScreenshots} activeOpacity={0.7}>
                  <Feather name="plus" size={ICON.md} color={PURPLE_LIGHT} />
                  <Text style={ss.addTileLabel}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
            {screenshots.length === 0 && (
              <Text style={ss.hintText}>Screenshot your Instagram grid, product pages, or any visual references.</Text>
            )}
            <PrimaryButton
              label={analyzing ? 'Analyzing...' : `Analyze ${screenshots.length > 0 ? screenshots.length + ' ' : ''}Screenshot${screenshots.length !== 1 ? 's' : ''}`}
              onPress={handleAnalyzeScreenshots}
              loading={analyzing}
              disabled={screenshots.length === 0 || analyzing}
              icon="zap"
              style={ss.actionBtn}
            />
          </>
        )}

        {/* ─── Posts Tab ────────────────────────────────────────── */}
        {activeTab === 'posts' && (
          <>
            <Text style={ss.tabInfo}>Select posts to base your storefront tone and theme on:</Text>
            {sellerPosts.map(post => {
              const selected = selectedPostIds.includes(post.id);
              return (
                <TouchableOpacity key={post.id} style={[ss.postRow, selected && ss.postRowSelected]} onPress={() => togglePost(post.id)}>
                  <View style={[ss.postCheck, selected && ss.postCheckActive]}>
                    {selected && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <View style={ss.postMeta}>
                    <Text style={ss.postTitle}>{post.title}</Text>
                    <Text style={ss.postDesc}>{post.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <PrimaryButton
              label={analyzing ? 'Generating...' : `Generate from ${selectedPostIds.length > 0 ? selectedPostIds.length + ' ' : ''}Post${selectedPostIds.length !== 1 ? 's' : ''}`}
              onPress={handleGenerateFromPosts}
              loading={analyzing}
              disabled={selectedPostIds.length === 0 || analyzing}
              icon="zap"
              style={ss.actionBtn}
            />
          </>
        )}

        {/* ─── URL Tab ─────────────────────────────────────────── */}
        {activeTab === 'url' && (
          <>
            <BrandthreadCard style={ss.card}>
              <Text style={ss.fieldLabel}>Social Profile or Website URL</Text>
              <TextInput
                style={ss.input}
                value={profileUrl}
                onChangeText={setProfileUrl}
                placeholder="instagram.com/yourbrand  or  yourbrand.com"
                placeholderTextColor={SUBTLE}
                autoCapitalize="none"
                keyboardType="url"
              />
              <Text style={ss.noteText}>
                AI will study your brand's visual identity and apply it to your storefront colors, typography, and layout.
              </Text>
            </BrandthreadCard>

            {analyzing ? (
              <View style={ss.loadingRow}>
                <ActivityIndicator color={PURPLE} />
                <Text style={ss.loadingText}>Analyzing brand identity with AI...</Text>
              </View>
            ) : (
              <PrimaryButton
                label="Analyze & Generate"
                onPress={handleAnalyzeUrl}
                disabled={!profileUrl.trim()}
                icon="zap"
                style={ss.actionBtn}
              />
            )}
          </>
        )}

        <SecondaryButton
          label="Build from scratch instead"
          onPress={() => router.push('/store-generate' as never)}
          style={ss.altBtn}
          icon="sliders"
        />
      </ScrollView>
    </View>
  );
}

const ss = StyleSheet.create({
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
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  scroll: { paddingBottom: 80, paddingTop: SP.md },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.md, lineHeight: 20 },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.md },
  bannerRow: { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  bannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  tabRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, marginBottom: SP.md, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.md },
  gridWrap: { position: 'relative' },
  gridImg: { width: 100, height: 100, borderRadius: RADIUS.md },
  removeBtn: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20,
    borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 100, height: 100, borderRadius: RADIUS.md,
    borderWidth: 2, borderColor: PURPLE_DIM, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addTileLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
  hintText: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', marginBottom: SP.md, paddingHorizontal: SP.xl },
  tabInfo: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginHorizontal: SP.md, marginBottom: SP.sm },
  postRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    marginHorizontal: SP.md, marginBottom: SP.sm, padding: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  postRowSelected: { borderColor: PURPLE_LIGHT, backgroundColor: 'rgba(139,92,246,0.08)' },
  postCheck: {
    width: 22, height: 22, borderRadius: RADIUS.xs,
    borderWidth: 1.5, borderColor: MUTED,
    alignItems: 'center', justifyContent: 'center',
  },
  postCheckActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  postMeta: { flex: 1 },
  postTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  postDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  input: {
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    backgroundColor: SURFACE, borderRadius: RADIUS.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: SP.md, paddingVertical: 10,
  },
  noteText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, justifyContent: 'center', padding: SP.md },
  loadingText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  actionBtn: { marginHorizontal: SP.md, marginBottom: SP.sm },
  altBtn: { marginHorizontal: SP.md, marginTop: SP.md },
});

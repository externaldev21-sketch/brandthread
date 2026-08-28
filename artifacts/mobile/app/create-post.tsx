// ─── Create Post Screen (2-screen redesign) ──────────────────────────────────
// Screen 1: pick media from camera roll or camera — post type auto-inferred
//   • video picked  → video post
//   • 1+ photos      → slideshow (or single photo shown as 1-slide)
//   • no media + seller + purpose chip → text-only announcement
//   • inline max-duration selector for video, no separate step
// Screen 2: caption · purpose chips · product tags · hashtags · publish
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Animated, Dimensions, Platform,
  ActivityIndicator, Alert, KeyboardAvoidingView, Switch, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { FONT, FS } from '@/lib/theme';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { getTaggableProducts } from '@/services/productService';
import { createSellerPost } from '@/services/socialService';
import StyleTagsPicker from '@/components/StyleTagsPicker';
import type { Product } from '@/services/productTypes';
import type {
  Sound, PostProductTag, PostHashtag, PostVisibility,
  MaxVideoDuration, ContentType,
} from '@/services/types';
import { useColors } from '@/hooks/useColors';

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG     = '#07070F';
const CARD   = '#12121F';
const BORDER = 'rgba(255,255,255,0.07)';
const FG     = '#F4F4FF';
const MUTED  = 'rgba(244,244,255,0.50)';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const ORANGE = '#F97316';
const CYAN   = '#22D3EE';
const PINK   = '#EC4899';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'media-pick' | 'post-details' | 'publishing' | 'done';

interface VideoClipLocal {
  uri: string;
  duration: number;
  id: string;
}
interface SlidePhotoLocal {
  uri: string;
  id: string;
}
interface OverlayText {
  id: string;
  text: string;
  color: string;
  fontSize: number;
}
interface SoundSelection {
  soundId: string;
  soundTitle: string;
  artist: string;
  startTime: number;
  volume: number;
}

// ─── Purpose chips (sellers only) ────────────────────────────────────────────
// Optional content-purpose overlay on top of media type.
const PURPOSE_CHIPS: Array<{
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  contentType: ContentType;
}> = [
  { label: 'Drop Announcement',    icon: 'bell',   color: ORANGE, contentType: 'countdown'     },
  { label: 'Behind the Scenes',    icon: 'camera', color: PINK,   contentType: 'behind_scenes' },
  { label: 'Product Announcement', icon: 'tag',    color: PURPLE, contentType: 'announcement'  },
];

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic: true,
  allowComments: true,
  allowReposts: true,
  showLikeCount: true,
};

// ─── Video preview ────────────────────────────────────────────────────────────
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  const PREVIEW_H = Math.min((screenWidth - 32) * 9 / 16, screenHeight * 0.35);
  return (
    <VideoView
      player={player}
      style={{ width: screenWidth - 32, height: PREVIEW_H, borderRadius: 12 }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ accountType?: string }>();
  const isBuyer = params.accountType === 'buyer';

  // ── Step ──
  const [step, setStep] = useState<Step>('media-pick');

  // ── Media ──
  const [videoClips, setVideoClips]   = useState<VideoClipLocal[]>([]);
  const [slidePhotos, setSlidePhotos] = useState<SlidePhotoLocal[]>([]);
  const [maxDuration, setMaxDuration] = useState<MaxVideoDuration>(30);

  // ── Purpose (seller text-only posts) ──
  const [activePurpose, setActivePurpose] = useState<typeof PURPOSE_CHIPS[0] | null>(null);

  // ── Post details ──
  const [caption, setCaption]                     = useState('');
  const [hashtags, setHashtags]                   = useState<PostHashtag[]>([]);
  const [hashtagInput, setHashtagInput]           = useState('');
  const [styleTags, setStyleTags]                 = useState<string[]>([]);
  const [location, setLocation]                   = useState('');
  const [visibility, setVisibility]               = useState<PostVisibility>(DEFAULT_VISIBILITY);
  const [scheduleMode, setScheduleMode]           = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt]             = useState<string | null>(null);
  const [scheduledDateInput, setScheduledDateInput] = useState('');
  const [productTags, setProductTags]             = useState<PostProductTag[]>([]);
  const [taggableProducts, setTaggableProducts]   = useState<Product[]>([]);
  const [taggableProductsError, setTaggableProductsError] = useState<string | null>(null);
  const [loadingTaggable, setLoadingTaggable]     = useState(false);

  // ── Sound / text overlays ──
  const [selectedSound, setSelectedSound] = useState<SoundSelection | null>(null);
  const [overlayTexts, setOverlayTexts]   = useState<OverlayText[]>([]);

  // ── Modals ──
  const [showSoundModal,    setShowSoundModal]    = useState(false);
  const [showTextModal,     setShowTextModal]     = useState(false);
  const [showProductModal,  setShowProductModal]  = useState(false);

  // ── Sound modal ──
  const [soundTab,    setSoundTab]    = useState<'trending'|'saved'|'recent'|'original'|'royalty_free'>('trending');
  const [soundSearch, setSoundSearch] = useState('');

  // ── Text modal ──
  const [newTextInput, setNewTextInput] = useState('');
  const [newTextColor, setNewTextColor] = useState('#FFFFFF');
  const [newTextSize,  setNewTextSize]  = useState(24);

  // ── Product modal ──
  const [productSearch, setProductSearch] = useState('');

  // ── Publishing ──
  const [isPublishing, setIsPublishing] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const botPad = Platform.OS === 'web' ? 20 : insets.bottom;

  function fetchTaggableProducts() {
    setLoadingTaggable(true);
    setTaggableProductsError(null);
    getTaggableProducts()
      .then(p => { setTaggableProducts(p); setTaggableProductsError(null); })
      .catch(() => { setTaggableProductsError('Could not load products. Tap to retry.'); })
      .finally(() => setLoadingTaggable(false));
  }

  useEffect(() => { fetchTaggableProducts(); }, []);

  // Pick up camera capture result on focus-return
  useFocusEffect(
    React.useCallback(() => {
      const result = (global as any).__cameraCaptureResult as
        | { type: 'video'; uri: string; duration: number }
        | { type: 'photo'; uri: string }
        | null | undefined;
      if (!result) return;
      (global as any).__cameraCaptureResult = null;
      if (result.type === 'video') {
        setVideoClips([{ uri: result.uri, duration: result.duration, id: `cam_${Date.now()}` }]);
        setSlidePhotos([]);
      } else {
        setSlidePhotos(prev => [...prev, { uri: result.uri, id: `cam_${Date.now()}` }]);
      }
    }, [])
  );

  // Publishing pulse animation
  useEffect(() => {
    if (step !== 'publishing') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [step]);

  // ── Derived ──
  const hasMedia   = videoClips.length > 0 || slidePhotos.length > 0;
  const canProceed = hasMedia || (!isBuyer && activePurpose !== null);

  function inferContentType(): ContentType {
    if (isBuyer) return 'story';
    if (videoClips.length > 0) return 'video';
    if (slidePhotos.length > 0) return 'slideshow';
    return activePurpose?.contentType ?? 'video';
  }

  // ── Helpers ──
  function haptic(fn: () => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow access to your media library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const videos = result.assets.filter(a => a.type === 'video');
    const photos = result.assets.filter(a => a.type !== 'video');

    if (videos.length > 0) {
      // Video overrides photo selection
      setVideoClips([{ uri: videos[0].uri, duration: videos[0].duration ?? 0, id: `clip-${Date.now()}` }]);
      setSlidePhotos([]);
    } else {
      // Photos (1 = single photo post, 2+ = slideshow — both go as 'slideshow' type)
      setSlidePhotos(prev => [...prev, ...photos.map((a, i) => ({ uri: a.uri, id: `photo-${Date.now()}-${i}` }))]);
      setVideoClips([]);
    }
  }

  function addHashtag(raw: string) {
    const tag = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (tag.length > 1 && !hashtags.find(h => h.tag === tag)) {
      setHashtags(prev => [...prev, { tag }]);
    }
    setHashtagInput('');
  }

  function useSound(sound: Sound) {
    setSelectedSound({ soundId: sound.id, soundTitle: sound.title, artist: sound.artist, startTime: 0, volume: 1 });
    setShowSoundModal(false);
  }

  function addText() {
    if (!newTextInput.trim()) return;
    setOverlayTexts(prev => [...prev, { id: `txt-${Date.now()}`, text: newTextInput.trim(), color: newTextColor, fontSize: newTextSize }]);
    setNewTextInput(''); setNewTextColor('#FFFFFF'); setNewTextSize(24);
    setShowTextModal(false);
  }

  function tagProduct(p: Product) {
    const already = productTags.find(t => t.productId === p.id);
    if (already) setProductTags(prev => prev.filter(t => t.productId !== p.id));
    else setProductTags(prev => [...prev, { productId: p.id, productName: p.name, price: p.pricing.price }]);
  }

  function resetAll() {
    setStep('media-pick');
    setVideoClips([]); setSlidePhotos([]); setMaxDuration(30);
    setActivePurpose(null);
    setCaption(''); setHashtags([]); setHashtagInput(''); setStyleTags([]);
    setLocation(''); setVisibility(DEFAULT_VISIBILITY);
    setScheduleMode('now'); setScheduledAt(null); setScheduledDateInput('');
    setProductTags([]); setSelectedSound(null); setOverlayTexts([]);
  }

  // ─── SCREEN 1: Media Picker ───────────────────────────────────────────────
  if (step === 'media-pick') {
    const DURATIONS: MaxVideoDuration[] = [10, 15, 30, 60];
    const durLabels: Record<number, string> = { 10: 'Short', 15: 'Standard', 30: 'Extended', 60: 'Long' };

    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => haptic(() => router.back())} style={s.iconBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{isBuyer ? 'Add to Story' : 'Create Post'}</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

          {/* ── Pickers (hide when media selected) ── */}
          {!hasMedia && (
            <View style={s.pickRow}>
              <TouchableOpacity style={s.pickCard} activeOpacity={0.8} onPress={pickFromLibrary}>
                <View style={[s.pickIconCircle, { backgroundColor: PURPLE + '22' }]}>
                  <Feather name="image" size={28} color={colors.primary} />
                </View>
                <Text style={s.pickCardTitle}>Camera Roll</Text>
                <Text style={s.pickCardSub}>Photos or video</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.pickCard}
                activeOpacity={0.8}
                onPress={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
              >
                <View style={[s.pickIconCircle, { backgroundColor: CYAN + '22' }]}>
                  <Feather name="camera" size={28} color={CYAN} />
                </View>
                <Text style={s.pickCardTitle}>Camera</Text>
                <Text style={s.pickCardSub}>Record or shoot</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Video preview + inline duration ── */}
          {videoClips.length > 0 && (
            <View>
              <View style={s.mediaHeader}>
                <Text style={s.sectionLabel}>Selected video</Text>
                <TouchableOpacity style={s.swapBtn} onPress={pickFromLibrary} activeOpacity={0.8}>
                  <Feather name="refresh-cw" size={13} color={MUTED} />
                  <Text style={s.swapBtnText}>Replace</Text>
                </TouchableOpacity>
              </View>
              <VideoPreview uri={videoClips[0].uri} />

              {/* Inline duration selector */}
              <Text style={[s.sectionLabel, { marginTop: 14 }]}>Max duration</Text>
              <View style={s.durationRow}>
                {DURATIONS.map((d) => {
                  const sel = maxDuration === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[s.durationChip, sel && s.durationChipSel]}
                      onPress={() => { Haptics.selectionAsync(); setMaxDuration(d); }}
                    >
                      <Text style={[s.durationChipTop, sel && { color: PURPLE }]}>{d}s</Text>
                      <Text style={[s.durationChipSub, sel && { color: PURPLE }]}>{durLabels[d]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Photo strip ── */}
          {slidePhotos.length > 0 && (
            <View>
              <View style={s.mediaHeader}>
                <Text style={s.sectionLabel}>
                  {slidePhotos.length === 1 ? 'Photo selected' : `Slideshow · ${slidePhotos.length} photos`}
                </Text>
                <TouchableOpacity style={s.swapBtn} onPress={pickFromLibrary} activeOpacity={0.8}>
                  <Feather name="plus" size={13} color={colors.primary} />
                  <Text style={[s.swapBtnText, { color: PURPLE }]}>Add more</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {slidePhotos.map((photo, idx) => (
                    <View key={photo.id} style={s.photoThumb}>
                      <Image source={{ uri: photo.uri }} style={s.photoThumbImg} resizeMode="cover" />
                      <TouchableOpacity
                        style={s.removeChip}
                        onPress={() => setSlidePhotos(prev => prev.filter(p => p.id !== photo.id))}
                      >
                        <Feather name="x" size={11} color={FG} />
                      </TouchableOpacity>
                      {idx === 0 && (
                        <View style={s.coverLabel}>
                          <Text style={s.coverLabelText}>cover</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
              <Text style={s.photoHint}>Tap × to remove · tap "Add more" to add photos</Text>
            </View>
          )}

          {/* ── Type badge ── */}
          {hasMedia && (
            <View style={s.typeBadge}>
              <Feather
                name={videoClips.length > 0 ? 'video' : slidePhotos.length > 1 ? 'layers' : 'image'}
                size={14} color={colors.primary}
              />
              <Text style={s.typeBadgeText}>
                {videoClips.length > 0
                  ? 'Video post'
                  : slidePhotos.length > 1
                  ? `Slideshow (${slidePhotos.length} photos)`
                  : 'Photo post'}
              </Text>
            </View>
          )}

          {/* ── Purpose chips for text-only seller posts ── */}
          {!isBuyer && !hasMedia && (
            <View style={{ marginTop: 28 }}>
              <Text style={s.sectionLabel}>Or create a text-only post</Text>
              <View style={s.chipRow}>
                {PURPOSE_CHIPS.map((chip) => {
                  const active = activePurpose?.label === chip.label;
                  return (
                    <TouchableOpacity
                      key={chip.label}
                      style={[s.purposeChip, active && { backgroundColor: chip.color + '22', borderColor: chip.color + '55' }]}
                      activeOpacity={0.8}
                      onPress={() => { Haptics.selectionAsync(); setActivePurpose(active ? null : chip); }}
                    >
                      <Feather name={chip.icon} size={14} color={active ? chip.color : MUTED} />
                      <Text style={[s.purposeChipText, active && { color: chip.color }]}>{chip.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom bar */}
        <View style={[s.bottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={[s.nextBtn, !canProceed && s.nextBtnDisabled]}
            activeOpacity={0.85}
            disabled={!canProceed}
            onPress={() => haptic(() => setStep('post-details'))}
          >
            <LinearGradient
              colors={canProceed ? [colors.primary, colors.accentForeground] : [BORDER, BORDER]}
              style={s.nextBtnGrad}
            >
              <Text style={[s.nextBtnText, !canProceed && { color: MUTED }]}>Next →</Text>
            </LinearGradient>
          </TouchableOpacity>
          {!canProceed && (
            <Text style={s.bottomHint}>
              {isBuyer ? 'Add a photo or video to continue' : 'Add media or select a post type above'}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ─── SCREEN 2: Post Details ────────────────────────────────────────────────
  if (step === 'post-details') {
    const ct = inferContentType();
    const typeLabel: Record<string, string> = {
      video: 'Video', slideshow: 'Slideshow', announcement: 'Product Announcement',
      countdown: 'Drop Announcement', behind_scenes: 'Behind the Scenes', story: 'Story',
    };
    const typeColor: Record<string, string> = {
      video: PURPLE, slideshow: CYAN, announcement: PURPLE,
      countdown: ORANGE, behind_scenes: PINK, story: BLUE,
    };
    const tColor = typeColor[ct] ?? PURPLE;
    const tLabel = typeLabel[ct] ?? ct;

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.root, { paddingTop: topPad }]}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => haptic(() => setStep('media-pick'))} style={s.iconBtn}>
              <Feather name="arrow-left" size={22} color={FG} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Post Details</Text>
            <View style={{ width: 38 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            {/* ── Mini preview card ── */}
            <View style={s.previewCard}>
              <LinearGradient colors={[tColor + '33', tColor + '11']} style={s.previewGrad}>
                <Feather
                  name={videoClips.length > 0 ? 'video' : slidePhotos.length > 1 ? 'layers' : 'image'}
                  size={22} color={tColor}
                />
              </LinearGradient>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.previewType}>{tLabel}</Text>
                <Text style={s.previewSub}>
                  {videoClips.length > 0
                    ? `${videoClips[0].duration.toFixed(1)}s · max ${maxDuration}s`
                    : slidePhotos.length > 0
                    ? `${slidePhotos.length} photo${slidePhotos.length > 1 ? 's' : ''}`
                    : activePurpose?.label ?? 'Text post'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => haptic(() => setStep('media-pick'))} style={s.editBtn}>
                <Feather name="edit-2" size={14} color={MUTED} />
              </TouchableOpacity>
            </View>

            {/* ── Purpose chips (sellers, optional ── */}
            {!isBuyer && (
              <View style={{ marginTop: 16 }}>
                <Text style={s.sectionLabel}>Content purpose <Text style={{ color: MUTED, fontFamily: FONT.regular }}>(optional)</Text></Text>
                <View style={s.chipRow}>
                  {PURPOSE_CHIPS.map((chip) => {
                    const active = activePurpose?.label === chip.label;
                    return (
                      <TouchableOpacity
                        key={chip.label}
                        style={[s.purposeChip, active && { backgroundColor: chip.color + '22', borderColor: chip.color + '55' }]}
                        activeOpacity={0.8}
                        onPress={() => { Haptics.selectionAsync(); setActivePurpose(active ? null : chip); }}
                      >
                        <Feather name={chip.icon} size={14} color={active ? chip.color : MUTED} />
                        <Text style={[s.purposeChipText, active && { color: chip.color }]}>{chip.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Caption ── */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>Caption</Text>
            <TextInput
              style={s.captionInput}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={2200}
              placeholder="Write a caption..."
              placeholderTextColor={MUTED}
            />
            <Text style={s.charCount}>{caption.length} / 2200</Text>

            {/* ── Hashtags ── */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Hashtags</Text>
            <TextInput
              style={s.inlineInput}
              value={hashtagInput}
              onChangeText={setHashtagInput}
              placeholder="#hashtag"
              placeholderTextColor={MUTED}
              returnKeyType="done"
              onSubmitEditing={() => { if (hashtagInput.trim().length > 1) addHashtag(hashtagInput); }}
              blurOnSubmit={false}
            />
            <Text style={s.helperText}>Add your own hashtags to help shoppers discover this post.</Text>
            {hashtags.length > 0 && (
              <View style={s.tagWrap}>
                {hashtags.map((h) => (
                  <TouchableOpacity key={h.tag} style={s.tagChip} onPress={() => setHashtags(prev => prev.filter(hh => hh.tag !== h.tag))}>
                    <Text style={s.tagChipText}>{h.tag}</Text>
                    <Feather name="x" size={11} color={colors.primary} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Style tags (sellers) ── */}
            {!isBuyer && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>Style Tags</Text>
                <StyleTagsPicker selected={styleTags} onChange={setStyleTags} max={5} />
              </>
            )}

            {/* ── Product tags (sellers) ── */}
            {!isBuyer && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 16 }]}>Tagged Products</Text>
                {productTags.length > 0 && (
                  <View style={s.tagWrap}>
                    {productTags.map((pt) => (
                      <View key={pt.productId} style={[s.tagChip, { backgroundColor: PURPLE + '11', borderColor: PURPLE + '33' }]}>
                        <Text style={[s.tagChipText, { color: FG }]}>{pt.productName}</Text>
                        <TouchableOpacity onPress={() => setProductTags(prev => prev.filter(t => t.productId !== pt.productId))}>
                          <Feather name="x" size={11} color={MUTED} style={{ marginLeft: 4 }} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                {taggableProductsError ? (
                  /* Error is scoped to this section only — rest of composer remains fully usable */
                  <TouchableOpacity
                    style={s.productErrorRow}
                    activeOpacity={0.8}
                    onPress={() => fetchTaggableProducts()}
                  >
                    <Feather name="alert-circle" size={14} color={ORANGE} />
                    <Text style={s.productErrorText}>{taggableProductsError}</Text>
                    <Feather name="refresh-cw" size={13} color={ORANGE} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[s.outlineBtn, { marginTop: 8 }]}
                    onPress={() => setShowProductModal(true)}
                    activeOpacity={0.8}
                    disabled={loadingTaggable}
                  >
                    {loadingTaggable ? (
                      <ActivityIndicator size="small" color={MUTED} style={{ marginRight: 6 }} />
                    ) : (
                      <Feather name="tag" size={14} color={FG} style={{ marginRight: 6 }} />
                    )}
                    <Text style={s.outlineBtnText}>{loadingTaggable ? 'Loading products…' : 'Tag products'}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* ── Sound (sellers) ── */}
            {!isBuyer && (
              selectedSound ? (
                <View style={[s.soundStrip, { marginTop: 16 }]}>
                  <Feather name="music" size={14} color={colors.primary} />
                  <Text style={s.soundStripText} numberOfLines={1}>{selectedSound.soundTitle} – {selectedSound.artist}</Text>
                  <TouchableOpacity onPress={() => setSelectedSound(null)}>
                    <Feather name="x" size={16} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={[s.outlineBtn, { marginTop: 16 }]} onPress={() => setShowSoundModal(true)} activeOpacity={0.8}>
                  <Feather name="music" size={14} color={FG} style={{ marginRight: 6 }} />
                  <Text style={s.outlineBtnText}>Add sound</Text>
                </TouchableOpacity>
              )
            )}

            {/* ── Location ── */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Location</Text>
            <View style={s.locationRow}>
              <Feather name="map-pin" size={16} color={MUTED} style={{ marginRight: 8 }} />
              <TextInput
                style={s.locationInput}
                value={location}
                onChangeText={setLocation}
                placeholder="Add location"
                placeholderTextColor={MUTED}
              />
            </View>

            {/* ── Settings ── */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>Settings</Text>
            {(
              [
                { label: 'Allow comments', key: 'allowComments' },
                { label: 'Allow reposts',  key: 'allowReposts'  },
                { label: 'Show like count', key: 'showLikeCount' },
              ] as const
            ).map(({ label, key }) => (
              <View key={key} style={s.toggleRow}>
                <Text style={s.toggleLabel}>{label}</Text>
                <Switch
                  value={visibility[key as keyof PostVisibility] as boolean}
                  onValueChange={(v) => setVisibility(prev => ({ ...prev, [key]: v }))}
                  thumbColor={(visibility[key as keyof PostVisibility] as boolean) ? PURPLE : MUTED}
                  trackColor={{ false: BORDER, true: PURPLE + '44' }}
                />
              </View>
            ))}

            {/* ── Schedule ── */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>Schedule</Text>
            <View style={s.scheduleRow}>
              {(['now', 'schedule'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[s.schedulePill, scheduleMode === mode && s.schedulePillActive]}
                  onPress={() => setScheduleMode(mode)}
                >
                  {scheduleMode === mode && <Feather name="check" size={12} color={colors.primary} style={{ marginRight: 4 }} />}
                  <Text style={[s.schedulePillText, scheduleMode === mode && { color: PURPLE }]}>
                    {mode === 'now' ? 'Publish now' : 'Schedule'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {scheduleMode === 'schedule' && (
              <TextInput
                style={[s.inlineInput, { marginTop: 10 }]}
                value={scheduledDateInput}
                onChangeText={(v) => { setScheduledDateInput(v); setScheduledAt(v); }}
                placeholder="YYYY-MM-DD HH:MM"
                placeholderTextColor={MUTED}
              />
            )}

            {/* ── Actions ── */}
            <TouchableOpacity
              style={[s.outlineBtn, { marginTop: 24 }]}
              activeOpacity={0.8}
              onPress={async () => {
                haptic(() => {});
                try {
                  await createSellerPost({
                    contentType: ct,
                    caption,
                    hashtags: hashtags.map(h => h.tag),
                    styleTags,
                    mediaUris: videoClips.length > 0 ? videoClips.map(c => c.uri) : slidePhotos.map(p => p.uri),
                    aspectRatio: '9:16',
                    productTags: productTags.map(p => ({ productId: p.productId, productName: p.productName, price: p.price })),
                    sound: selectedSound ?? undefined,
                    visibility,
                    isDraft: true,
                  });
                  Alert.alert('Draft saved', 'Your draft has been saved.', [{ text: 'OK', onPress: () => router.back() }]);
                 } catch (error) {
                   Alert.alert('Draft not saved', error instanceof Error ? error.message : 'Could not save draft. Please try again.');
                }
              }}
            >
              <Feather name="save" size={16} color={FG} style={{ marginRight: 8 }} />
              <Text style={s.outlineBtnText}>Save as draft</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 10 }}
              activeOpacity={0.85}
              disabled={isPublishing}
              onPress={async () => {
                haptic(() => {});
                if (isPublishing) return;
                setIsPublishing(true);
                setStep('publishing');
                try {
                  await createSellerPost({
                    contentType: ct,
                    caption,
                    hashtags: hashtags.map(h => h.tag),
                    styleTags,
                    mediaUris: videoClips.length > 0 ? videoClips.map(c => c.uri) : slidePhotos.map(p => p.uri),
                    aspectRatio: '9:16',
                    productTags: productTags.map(p => ({ productId: p.productId, productName: p.productName, price: p.price })),
                    sound: selectedSound ?? undefined,
                    visibility,
                    isDraft: false,
                    scheduledAt: scheduleMode === 'schedule' ? scheduledAt : null,
                  });
                  setStep('done');
                 } catch (error) {
                  setStep('post-details');
                   Alert.alert('Publish failed', error instanceof Error ? error.message : 'Something went wrong. Please try again.');
                } finally {
                  setIsPublishing(false);
                }
              }}
            >
              <LinearGradient colors={[colors.primary, colors.accentForeground]} style={s.publishBtn}>
                <Feather name="send" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={s.publishBtnText}>Publish now</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>

          <ProductModal
            visible={showProductModal} onClose={() => setShowProductModal(false)}
            productSearch={productSearch} setProductSearch={setProductSearch}
            productTags={productTags} onTag={tagProduct}
            taggableProducts={taggableProducts}
            productsError={taggableProductsError}
            onRetryProducts={fetchTaggableProducts}
            insets={insets}
          />
          <SoundModal
            visible={showSoundModal} onClose={() => setShowSoundModal(false)}
            soundTab={soundTab} setSoundTab={setSoundTab}
            soundSearch={soundSearch} setSoundSearch={setSoundSearch}
            onUse={useSound} insets={insets}
          />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Publishing ───────────────────────────────────────────────────────────
  if (step === 'publishing') {
    return (
      <View style={[s.root, s.center, { paddingTop: topPad, paddingBottom: botPad }]}>
        <Animated.View style={[s.bigCircle, { transform: [{ scale: pulseAnim }] }]}>
          <LinearGradient colors={[colors.accent, colors.accent]} style={s.bigCircleGrad}>
            <Feather name="upload-cloud" size={36} color={colors.primary} />
          </LinearGradient>
        </Animated.View>
        <Text style={[s.doneTitle, { marginTop: 24 }]}>Publishing...</Text>
        <Text style={s.doneSub}>Your content is being prepared for Thread.</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      </View>
    );
  }

  // ─── Done ─────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={[s.root, s.center, { paddingTop: topPad, paddingBottom: botPad }]}>
        <LinearGradient colors={[colors.accent, colors.accent]} style={s.bigCircleGrad}>
          <Feather name="check" size={44} color={colors.primary} />
        </LinearGradient>
        <Text style={s.doneTitle}>Posted!</Text>
        <Text style={s.doneSub}>Your post has been saved and will appear on your profile.</Text>
        <TouchableOpacity
          style={{ marginTop: 24 }}
          activeOpacity={0.85}
          onPress={() => haptic(() => router.replace('/(tabs)/profile' as never))}
        >
          <LinearGradient colors={[colors.primary, colors.accentForeground]} style={s.publishBtn}>
            <Text style={s.publishBtnText}>View Profile</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.outlineBtn, { marginTop: 12, alignSelf: 'center', paddingHorizontal: 32 }]}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); resetAll(); }}
        >
          <Text style={s.outlineBtnText}>Create Another</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

// ─── Sound Modal ──────────────────────────────────────────────────────────────
interface SoundModalProps {
  visible: boolean; onClose: () => void;
  soundTab: 'trending'|'saved'|'recent'|'original'|'royalty_free';
  setSoundTab: (t: 'trending'|'saved'|'recent'|'original'|'royalty_free') => void;
  soundSearch: string; setSoundSearch: (s: string) => void;
  onUse: (sound: Sound) => void;
  insets: { top: number; bottom: number };
}
function SoundModal({ visible, onClose, soundTab, setSoundTab, soundSearch, setSoundSearch, onUse, insets }: SoundModalProps) {
  const tabs = [
    { id: 'trending' as const, label: 'Trending' }, { id: 'saved' as const, label: 'Saved' },
    { id: 'recent' as const, label: 'Recent' }, { id: 'original' as const, label: 'Original' },
    { id: 'royalty_free' as const, label: 'Free' },
  ];
  const filtered: Sound[] = [];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Sounds</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={sm.searchWrap}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput style={sm.searchInput} value={soundSearch} onChangeText={setSoundSearch} placeholder="Search sounds..." placeholderTextColor={MUTED} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
            {tabs.map((t) => (
              <TouchableOpacity key={t.id} style={[sm.tabPill, soundTab === t.id && sm.tabPillActive]} onPress={() => setSoundTab(t.id)}>
                <Text style={[sm.tabText, soundTab === t.id && { color: PURPLE }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Feather name="music" size={28} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 10, fontFamily: FONT.regular, textAlign: 'center' }}>The sound library is not available yet.</Text>
            </View>
          ) : filtered.map((sound) => (
            <View key={sound.id} style={sm.soundRow}>
              <View style={sm.soundIcon}><Feather name="music" size={16} color={PURPLE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={sm.soundTitle}>{sound.title}</Text>
                <Text style={sm.soundArtist}>{sound.artist}</Text>
              </View>
              <Text style={sm.soundDur}>{sound.duration}s</Text>
              <TouchableOpacity style={sm.useBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUse(sound); }}>
                <Text style={sm.useBtnText}>Use</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={sm.disclaimer}>
            <Text style={sm.disclaimerText}>⚠ All sounds are royalty-free tracks cleared for commercial use.</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Text Modal ───────────────────────────────────────────────────────────────
interface TextModalProps {
  visible: boolean; onClose: () => void;
  newTextInput: string; setNewTextInput: (v: string) => void;
  newTextColor: string; setNewTextColor: (v: string) => void;
  newTextSize: number; setNewTextSize: (v: number) => void;
  onAdd: () => void;
  overlayTexts: Array<{ id: string; text: string; color: string; fontSize: number }>;
  onRemoveText: (id: string) => void;
  insets: { top: number; bottom: number };
}
function TextModal({ visible, onClose, newTextInput, setNewTextInput, newTextColor, setNewTextColor, newTextSize, setNewTextSize, onAdd, overlayTexts, onRemoveText, insets }: TextModalProps) {
  const SWATCHES = ['#FFFFFF', '#000000', '#F87171', '#8B5CF6', '#3B82F6', '#FBBF24', '#22D3EE'];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Add Text</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}><Feather name="x" size={20} color={FG} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <TextInput style={sm.textInput} value={newTextInput} onChangeText={setNewTextInput} placeholder="Enter text..." placeholderTextColor={MUTED} />
          <Text style={sm.modalLabel}>Font Size</Text>
          <View style={sm.stepperRow}>
            <TouchableOpacity style={sm.stepperBtn} onPress={() => setNewTextSize(Math.max(12, newTextSize - 2))}><Feather name="minus" size={16} color={FG} /></TouchableOpacity>
            <Text style={sm.stepperVal}>{newTextSize}px</Text>
            <TouchableOpacity style={sm.stepperBtn} onPress={() => setNewTextSize(Math.min(64, newTextSize + 2))}><Feather name="plus" size={16} color={FG} /></TouchableOpacity>
          </View>
          <Text style={sm.modalLabel}>Color</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {SWATCHES.map((c) => (
              <TouchableOpacity key={c} style={[sm.swatch, { backgroundColor: c }, newTextColor === c && sm.swatchActive]} onPress={() => setNewTextColor(c)} />
            ))}
          </View>
          <TouchableOpacity style={{ marginTop: 8 }} onPress={onAdd} activeOpacity={0.85}>
            <LinearGradient colors={[PURPLE, '#6D28D9']} style={sm.addTextBtn}><Text style={sm.addTextBtnText}>Add Text</Text></LinearGradient>
          </TouchableOpacity>
          {overlayTexts.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={sm.modalLabel}>Existing overlays</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {overlayTexts.map((ot) => (
                  <View key={ot.id} style={[sm.overlayChip, { borderColor: ot.color + '66' }]}>
                    <Text style={[sm.overlayChipText, { color: ot.color }]}>{ot.text}</Text>
                    <TouchableOpacity onPress={() => onRemoveText(ot.id)}>
                      <Feather name="x" size={12} color={MUTED} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Product Modal ────────────────────────────────────────────────────────────
interface ProductModalProps {
  visible: boolean; onClose: () => void;
  productSearch: string; setProductSearch: (v: string) => void;
  productTags: PostProductTag[]; onTag: (p: Product) => void;
  taggableProducts: Product[];
  productsError?: string | null;
  onRetryProducts?: () => void;
  insets: { top: number; bottom: number };
}
function ProductModal({ visible, onClose, productSearch, setProductSearch, productTags, onTag, taggableProducts, productsError, onRetryProducts, insets }: ProductModalProps) {
  const filtered = taggableProducts.filter(p => productSearch === '' || p.name.toLowerCase().includes(productSearch.toLowerCase()));
  const statusColor = (st: string) => st === 'active' ? PURPLE : st === 'scheduled' ? ORANGE : MUTED;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Tag Products</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}><Feather name="x" size={20} color={FG} /></TouchableOpacity>
        </View>
        {productTags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {productTags.map((pt) => {
                const prod = taggableProducts.find(p => p.id === pt.productId);
                return (
                  <View key={pt.productId} style={sm.taggedChip}>
                    <Text style={sm.taggedChipText}>{pt.productName}</Text>
                    <TouchableOpacity onPress={() => prod && onTag(prod)}>
                      <Feather name="x" size={11} color={PURPLE} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
        {productsError ? (
          <View style={sm.productModalError}>
            <Feather name="alert-circle" size={28} color={ORANGE} style={{ marginBottom: 10 }} />
            <Text style={sm.productModalErrorTitle}>Couldn't load products</Text>
            <Text style={sm.productModalErrorBody}>{productsError}</Text>
            <TouchableOpacity
              style={sm.productModalRetryBtn}
              activeOpacity={0.8}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onRetryProducts?.(); }}
            >
              <Feather name="refresh-cw" size={14} color="#fff" style={{ marginRight: 6 }} />
              <Text style={sm.productModalRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={[sm.searchWrap, { marginTop: 8 }]}>
              <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
              <TextInput style={sm.searchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor={MUTED} />
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
              {filtered.length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 40 }}>
                  <Feather name="tag" size={28} color={MUTED} />
                  <Text style={{ color: MUTED, marginTop: 10, fontFamily: FONT.regular }}>
                    {productSearch ? 'No products match your search' : 'No products available to tag'}
                  </Text>
                </View>
              ) : filtered.map((p) => {
                const isTagged = productTags.some(t => t.productId === p.id);
                return (
                  <View key={p.id} style={sm.productRow}>
                    <View style={[sm.productSwatch, { backgroundColor: BORDER }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={sm.productName}>{p.name}</Text>
                      <Text style={sm.productPrice}>${p.pricing.price.toFixed(2)}</Text>
                    </View>
                    <View style={[sm.statusBadge, { backgroundColor: statusColor(p.status) + '22' }]}>
                      <Text style={[sm.statusBadgeText, { color: statusColor(p.status) }]}>{p.status}</Text>
                    </View>
                    <TouchableOpacity
                      style={[sm.tagBtn, isTagged && sm.tagBtnActive]}
                      onPress={() => { Haptics.selectionAsync(); onTag(p); }}
                    >
                      <Text style={[sm.tagBtnText, isTagged && { color: '#FFFFFF' }]}>{isTagged ? 'Remove' : 'Tag'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.85}>
            <LinearGradient colors={[PURPLE, '#6D28D9']} style={sm.addTextBtn}>
              <Text style={sm.addTextBtnText}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  iconBtn:     { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  // Screen 1 — media pick
  pickRow:       { flexDirection: 'row', gap: 12 },
  pickCard:      { flex: 1, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 28, gap: 10 },
  pickIconCircle:{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pickCardTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  pickCardSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  mediaHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  swapBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  swapBtnText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  durationRow:     { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 12 },
  durationChip:    { flex: 1, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 12 },
  durationChipSel: { backgroundColor: PURPLE + '11', borderColor: PURPLE },
  durationChipTop: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  durationChipSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  photoThumb:    { width: 90, height: 90, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 90, height: 90 },
  removeChip:    { position: 'absolute', top: 4, right: 4, backgroundColor: '#00000088', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  coverLabel:    { position: 'absolute', bottom: 4, left: 4, backgroundColor: PURPLE, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  coverLabelText:{ fontSize: 9, fontFamily: FONT.bold, color: '#fff' },
  photoHint:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 8 },

  typeBadge:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PURPLE + '11', borderRadius: 10, borderWidth: 1, borderColor: PURPLE + '33', paddingHorizontal: 12, paddingVertical: 8, marginTop: 14 },
  typeBadgeText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },

  chipRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  purposeChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 9 },
  purposeChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  bottomBar:      { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  nextBtn:        { borderRadius: 14, overflow: 'hidden' },
  nextBtnDisabled:{ opacity: 0.45 },
  nextBtnGrad:    { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  nextBtnText:    { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  bottomHint:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 8 },

  // Screen 2 — post details
  previewCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  previewGrad: { width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  previewType: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  previewSub:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  editBtn:     { width: 32, height: 32, backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  sectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  captionInput: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, padding: 12, minHeight: 100, textAlignVertical: 'top' },
  charCount:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'right', marginTop: 4 },
  helperText:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 8 },
  inlineInput:  { backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: 12, paddingVertical: 10 },

  suggestedChip:    { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  suggestedChipText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  tagWrap:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tagChip:          { flexDirection: 'row', alignItems: 'center', backgroundColor: PURPLE + '11', borderRadius: 14, borderWidth: 1, borderColor: PURPLE + '33', paddingHorizontal: 10, paddingVertical: 5 },
  tagChipText:      { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE },

  soundStrip:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PURPLE + '11', borderRadius: 10, borderWidth: 1, borderColor: PURPLE + '33', paddingHorizontal: 12, paddingVertical: 8 },
  soundStripText:{ flex: 1, fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE },

  locationRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10 },
  locationInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  toggleLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  scheduleRow:      { flexDirection: 'row', gap: 10 },
  schedulePill:     { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 8 },
  schedulePillActive:{ backgroundColor: PURPLE + '11', borderColor: PURPLE + '44' },
  schedulePillText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  outlineBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 12, paddingHorizontal: 16 },
  outlineBtnText:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  // Inline product error (doesn't block composer)
  productErrorRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: ORANGE + '44', paddingHorizontal: 12, paddingVertical: 10 },
  productErrorText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE, lineHeight: 16 },

  publishBtn:    { borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  publishBtnText:{ fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },

  // Publishing + done
  bigCircle:    { width: 100, height: 100, borderRadius: 50 },
  bigCircleGrad:{ width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  doneTitle:    { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginTop: 20 },
  doneSub:      { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 8, paddingHorizontal: 32 },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────
const sm = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  title:      { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  closeBtn:   { width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 16, marginTop: 12 },
  searchInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  tabPill:    { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tabPillActive:{ backgroundColor: PURPLE + '11', borderColor: PURPLE + '44' },
  tabText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  soundRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  soundIcon:  { width: 36, height: 36, backgroundColor: PURPLE + '11', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  soundTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  soundArtist:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  soundDur:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  useBtn:     { backgroundColor: PURPLE + '22', borderRadius: 8, borderWidth: 1, borderColor: PURPLE + '44', paddingHorizontal: 12, paddingVertical: 6 },
  useBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },
  disclaimer: { marginTop: 20, padding: 12, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER },
  disclaimerText:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  textInput:  { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, padding: 12, minHeight: 80, marginBottom: 16 },
  modalLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  stepperBtn: { width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepperVal: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, minWidth: 50, textAlign: 'center' },
  swatch:     { width: 30, height: 30, borderRadius: 15 },
  swatchActive:{ borderWidth: 2, borderColor: FG },
  addTextBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  addTextBtnText:{ fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  overlayChip:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  overlayChipText:{ fontSize: FS.sm, fontFamily: FONT.regular },
  taggedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: PURPLE + '22', borderRadius: 14, borderWidth: 1, borderColor: PURPLE + '44', paddingHorizontal: 10, paddingVertical: 5 },
  taggedChipText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },
  productRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 10 },
  productSwatch:{ width: 40, height: 40, borderRadius: 8, backgroundColor: CARD },
  productName:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  productPrice:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText:{ fontSize: FS.xs, fontFamily: FONT.semibold },
  tagBtn:     { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tagBtnActive:{ backgroundColor: PURPLE, borderColor: PURPLE },
  tagBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },

  // Product modal error state
  productModalError:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  productModalErrorTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: 6, textAlign: 'center' },
  productModalErrorBody:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  productModalRetryBtn:   { flexDirection: 'row', alignItems: 'center', backgroundColor: ORANGE, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  productModalRetryText:  { fontSize: FS.sm, fontFamily: FONT.bold, color: '#fff' },
});

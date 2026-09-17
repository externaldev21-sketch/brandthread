// ─── Create Post Screen — TikTok-style full-screen media-first flow ────────────
// Screen A: media-pick   → full-screen black, bottom upload/camera row
// Screen B: video-edit   → full-screen video preview, floating right toolbar
// Screen C: post-details → caption + thumbnail at top, settings rows, dual CTA
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Animated, Dimensions, Platform,
  ActivityIndicator, Alert, KeyboardAvoidingView, Switch, Image, Pressable,
  StatusBar,
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
import {
  createSellerPost, getSellerPosts, updateSellerPost,
  type SellerThreadPost,
} from '@/services/socialService';
import type { Product } from '@/services/productTypes';
import type {
  Sound, PostProductTag, PostHashtag, PostVisibility,
  MaxVideoDuration, ContentType,
} from '@/services/types';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { useApi } from '@/lib/api';
import { markVideoClipUploaded, normalizeTrimBounds } from '@/lib/videoEditing';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG       = '#000000';
const BG_SOFT  = '#0A0A0B';
const CARD     = '#18181B';
const BORDER   = 'rgba(255,255,255,0.08)';
const FG       = '#F4F4FF';
const MUTED    = 'rgba(244,244,255,0.50)';
const ORANGE   = '#F97316';

const { width: SW } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = 'media-pick' | 'video-edit' | 'post-details' | 'publishing' | 'done';

interface VideoClipLocal {
  uri: string; duration: number; id: string;
  speed: 0.5 | 1 | 2 | 3; filter: 'none' | 'warm' | 'cool' | 'mono';
  objectPath?: string;
}
interface ComposedVideoLocal {
  mediaUrl: string; mediaPath: string;
  thumbnailUrl: string; thumbnailPath: string; duration: number;
}
interface SlidePhotoLocal { uri: string; id: string; }
interface SoundSelection {
  soundId: string; soundTitle: string; artist: string; startTime: number; volume: number;
}

// ─── Purpose chips (sellers only) ────────────────────────────────────────────
const getPurposeChips = (accent: string) => [
  { label: 'Drop Announcement',    icon: 'bell'   as const, color: ORANGE, contentType: 'countdown'     as ContentType },
  { label: 'Behind the Scenes',    icon: 'camera' as const, color: '#A1A1AA', contentType: 'behind_scenes' as ContentType },
  { label: 'Product Announcement', icon: 'tag'    as const, color: accent, contentType: 'announcement'  as ContentType },
];

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true,
};

// ─── Full-screen video preview ─────────────────────────────────────────────────
function FullVideoPreview({ uri, seekTime, playbackRate = 1 }: {
  uri: string; seekTime?: number; playbackRate?: number;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  useEffect(() => {
    if (seekTime === undefined || !Number.isFinite(seekTime)) return;
    player.currentTime = Math.max(0, seekTime);
  }, [player, seekTime]);
  useEffect(() => { player.playbackRate = playbackRate; }, [playbackRate, player]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ─── Small inline video preview (for post-details thumbnail) ──────────────────
function ThumbVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = true; p.play(); });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ─── Floating right toolbar button ────────────────────────────────────────────
function ToolBtn({ icon, label, onPress }: {
  icon: keyof typeof Feather.glyphMap; label?: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={ts.toolBtn} activeOpacity={0.75}>
      <Feather name={icon} size={26} color={FG} />
      {label ? <Text style={ts.toolBtnLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

// ─── Settings row ─────────────────────────────────────────────────────────────
function SettingsRow({ label, value, onPress, children }: {
  label: string; value?: string; onPress?: () => void; children?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={ts.settingsRow}
    >
      <Text style={ts.settingsRowLabel}>{label}</Text>
      <View style={ts.settingsRowRight}>
        {value ? <Text style={ts.settingsRowValue}>{value}</Text> : null}
        {children}
        {onPress ? <Feather name="chevron-right" size={16} color={MUTED} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const colors   = useColors();
  const { theme } = useAppTheme();
  const PURPLE   = colors.primary;
  const PURPOSE_CHIPS = React.useMemo(() => getPurposeChips(colors.primary), [colors.primary]);
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const api      = useApi();
  const params   = useLocalSearchParams<{ accountType?: string; editId?: string; from?: string }>();
  const isBuyer  = params.accountType === 'buyer';
  const editId   = typeof params.editId === 'string' ? params.editId : undefined;
  const isSellerSetup = isSellerSetupOrigin(params.from);

  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const botPad = Platform.OS === 'web' ? 20 : insets.bottom;

  function leaveSetupDestination() {
    if (isSellerSetup) { router.replace(SELLER_HOME_ROUTE as never); return; }
    router.back();
  }

  // ── Step ──
  const [step, setStep] = useState<Step>('media-pick');

  // ── Media ──
  const [videoClips,    setVideoClips]   = useState<VideoClipLocal[]>([]);
  const [slidePhotos,   setSlidePhotos]  = useState<SlidePhotoLocal[]>([]);
  const [maxDuration,   setMaxDuration]  = useState<MaxVideoDuration>(30);
  const [trimStart,     setTrimStart]    = useState(0);
  const [trimEnd,       setTrimEnd]      = useState(0);
  const [scrubTime,     setScrubTime]    = useState(0);
  const [previewSeekTime,setPreviewSeekTime] = useState(0);
  const [previewClipIndex,setPreviewClipIndex] = useState(0);
  const [composedVideo, setComposedVideo] = useState<ComposedVideoLocal | null>(null);
  const [processingPhase, setProcessingPhase] = useState<'idle'|'uploading'|'processing'|'error'|'ready'>('idle');
  const [processingError, setProcessingError] = useState<string | null>(null);
  const timelineWidthRef = useRef(1);

  // ── Purpose ──
  const [activePurpose, setActivePurpose] = useState<typeof PURPOSE_CHIPS[0] | null>(null);

  // ── Post details ──
  const [caption,            setCaption]            = useState('');
  const [hashtags,           setHashtags]           = useState<PostHashtag[]>([]);
  const [hashtagInput,       setHashtagInput]       = useState('');
  const [location,           setLocation]           = useState('');
  const [visibility,         setVisibility]         = useState<PostVisibility>(DEFAULT_VISIBILITY);
  const [scheduleMode,       setScheduleMode]       = useState<'now'|'schedule'>('now');
  const [scheduledAt,        setScheduledAt]        = useState<string | null>(null);
  const [scheduledDateInput, setScheduledDateInput] = useState('');
  const [productTags,        setProductTags]        = useState<PostProductTag[]>([]);
  const [taggableProducts,   setTaggableProducts]   = useState<Product[]>([]);
  const [loadingTaggable,    setLoadingTaggable]    = useState(false);
  const [styleTags,          setStyleTags]          = useState<string[]>([]);

  // ── Sound / overlays ──
  const [selectedSound,  setSelectedSound]  = useState<SoundSelection | null>(null);

  // ── Modals ──
  const [showSoundModal,   setShowSoundModal]   = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);

  // ── Sound modal ──
  const [soundTab,    setSoundTab]    = useState<'trending'|'saved'|'recent'|'original'|'royalty_free'>('trending');
  const [soundSearch, setSoundSearch] = useState('');

  // ── Product modal ──
  const [productSearch, setProductSearch] = useState('');

  // ── Publishing ──
  const [isPublishing, setIsPublishing] = useState(false);
  const [editingPost,  setEditingPost]  = useState<SellerThreadPost | null>(null);
  const [loadingEdit,  setLoadingEdit]  = useState(!!editId);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  function fetchTaggableProducts() {
    setLoadingTaggable(true);
    getTaggableProducts()
      .then(p  => setTaggableProducts(p))
      .catch(() => setTaggableProducts([]))
      .finally(() => setLoadingTaggable(false));
  }

  useEffect(() => { fetchTaggableProducts(); }, []);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    setLoadingEdit(true);
    getSellerPosts()
      .then((posts) => {
        if (!active) return;
        const post = posts.find(item => item.id === editId);
        if (!post) { leaveSetupDestination(); return; }
        setEditingPost(post);
        setCaption(post.caption);
        setHashtags(post.hashtags.map(tag => ({ tag })));
        setStyleTags(post.styleTags ?? []);
        setProductTags(post.productTags.map(tag => ({
          productId: tag.productId, productName: tag.productName, priceCents: tag.priceCents,
        })));
        setSelectedSound(post.sound ?? null);
        setVisibility({ isPublic: true, ...post.visibility });
        setScheduledAt(post.scheduledAt);
        setScheduledDateInput(post.scheduledAt ?? '');
        setScheduleMode(post.postStatus === 'scheduled' ? 'schedule' : 'now');
        if (post.contentType === 'video' && post.mediaUris[0]) {
          setVideoClips([{ uri: post.mediaUris[0], duration: 0, id: `edit-video-${post.id}`, speed: 1, filter: 'none' }]);
          setSlidePhotos([]);
        } else {
          setSlidePhotos(post.mediaUris.map((uri, index) => ({ uri, id: `edit-photo-${post.id}-${index}` })));
          setVideoClips([]);
        }
        setActivePurpose(PURPOSE_CHIPS.find(chip => chip.contentType === post.contentType) ?? null);
        setStep('post-details');
      })
      .catch(() => { if (!active) return; leaveSetupDestination(); })
      .finally(() => { if (active) setLoadingEdit(false); });
    return () => { active = false; };
  }, [editId]);

  useFocusEffect(
    useCallback(() => {
      const result = (global as any).__cameraCaptureResult as
        | { type: 'video'; clips?: Array<{ id: string; uri: string; duration: number; speed: 0.5|1|2|3; filter: 'none'|'warm'|'cool'|'mono' }>; uri?: string; duration: number; }
        | { type: 'photo'; uri: string }
        | null | undefined;
      if (!result) return;
      (global as any).__cameraCaptureResult = null;
      if (result.type === 'video') {
        const captured = result.clips?.length
          ? result.clips
          : result.uri
            ? [{ uri: result.uri, duration: result.duration, id: `cam_${Date.now()}`, speed: 1 as const, filter: 'none' as const }]
            : [];
        const total = captured.reduce((sum, clip) => sum + clip.duration / clip.speed, 0);
        setVideoClips(captured); setTrimStart(0); setTrimEnd(total); setScrubTime(0);
        setPreviewSeekTime(0); setPreviewClipIndex(0); setComposedVideo(null);
        setProcessingPhase('idle'); setProcessingError(null); setSlidePhotos([]);
      } else {
        setSlidePhotos(prev => [...prev, { uri: result.uri, id: `cam_${Date.now()}` }]);
      }
    }, [])
  );

  useEffect(() => {
    if (step !== 'publishing') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
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

  function haptic(fn: () => void) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); fn(); }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required', 'Please allow access to your media library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const videos = result.assets.filter(a => a.type === 'video');
    const photos = result.assets.filter(a => a.type !== 'video');
    if (videos.length > 0) {
      const d = Math.max(0.1, (videos[0].duration ?? 0) / 1000);
      setVideoClips([{ uri: videos[0].uri, duration: d, id: `clip-${Date.now()}`, speed: 1, filter: 'none' }]);
      setTrimStart(0); setTrimEnd(d); setScrubTime(0); setPreviewSeekTime(0);
      setPreviewClipIndex(0); setComposedVideo(null); setProcessingPhase('idle');
      setProcessingError(null); setSlidePhotos([]);
    } else {
      setSlidePhotos(prev => [...prev, ...photos.map((a, i) => ({ uri: a.uri, id: `photo-${Date.now()}-${i}` }))]);
      setVideoClips([]);
    }
  }

  function addHashtag(raw: string) {
    const tag = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (tag.length > 1 && !hashtags.find(h => h.tag === tag)) setHashtags(prev => [...prev, { tag }]);
    setHashtagInput('');
  }

  function useSound(sound: Sound) {
    setSelectedSound({ soundId: sound.id, soundTitle: sound.title, artist: sound.artist, startTime: 0, volume: 1 });
    setShowSoundModal(false);
  }

  function tagProduct(p: Product) {
    const already = productTags.find(t => t.productId === p.id);
    if (already) setProductTags(prev => prev.filter(t => t.productId !== p.id));
    else setProductTags(prev => [...prev, { productId: p.id, productName: p.name, priceCents: p.pricing.priceCents }]);
  }

  function resetAll() {
    setStep('media-pick');
    setVideoClips([]); setSlidePhotos([]); setMaxDuration(30);
    setTrimStart(0); setTrimEnd(0); setScrubTime(0); setPreviewSeekTime(0); setPreviewClipIndex(0);
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
    setActivePurpose(null); setCaption(''); setHashtags([]); setHashtagInput(''); setStyleTags([]);
    setLocation(''); setVisibility(DEFAULT_VISIBILITY); setScheduleMode('now');
    setScheduledAt(null); setScheduledDateInput(''); setProductTags([]);
    setSelectedSound(null);
  }

  async function persistSellerPost(isDraft: boolean): Promise<void> {
    const contentType = inferContentType();
    const postStatus: SellerThreadPost['postStatus'] = isDraft
      ? 'draft'
      : scheduleMode === 'schedule' && scheduledAt
        ? 'scheduled' : 'published';
    const mediaUris = composedVideo
      ? [composedVideo.mediaUrl]
      : videoClips.length > 0 ? videoClips.map(c => c.uri) : slidePhotos.map(p => p.uri);
    const values = {
      contentType, caption,
      hashtags: hashtags.map(h => h.tag),
      styleTags, mediaUris,
      mediaUrl: composedVideo?.mediaUrl ?? mediaUris[0],
      mediaPath: composedVideo?.mediaPath,
      thumbnailPath: composedVideo?.thumbnailPath,
      thumbnailUri: composedVideo?.thumbnailUrl ?? editingPost?.thumbnailUri,
      aspectRatio: '9:16' as const,
      productTags: productTags.map(pt => ({
        productId: pt.productId, productName: pt.productName, priceCents: pt.priceCents,
      })),
      sound: selectedSound ?? undefined,
      visibility, isDraft,
      scheduledAt: isDraft || scheduleMode === 'now' ? null : scheduledAt,
    };
    if (editId) await updateSellerPost(editId, { ...values, postStatus });
    else await createSellerPost(values);
  }

  const totalVideoDuration = videoClips.reduce((sum, clip) => sum + clip.duration / clip.speed, 0);

  function updateTrim(nextStart: number, nextEnd: number) {
    const { start, end } = normalizeTrimBounds(totalVideoDuration, nextStart, nextEnd);
    setTrimStart(start); setTrimEnd(end);
    setScrubTime(Math.max(start, Math.min(scrubTime, end)));
    setComposedVideo(null); setProcessingPhase('idle'); setProcessingError(null);
  }

  async function processVideo() {
    if (videoClips.length === 0 || processingPhase === 'uploading' || processingPhase === 'processing') return;
    setProcessingError(null);
    setProcessingPhase('uploading');
    const uploaded = [...videoClips];
    try {
      for (let i = 0; i < uploaded.length; i += 1) {
        if (uploaded[i].objectPath) continue;
        const result = await api.posts.uploadVideoClip(uploaded[i].uri);
        const next = markVideoClipUploaded(uploaded, uploaded[i].id, result.objectPath);
        uploaded.splice(0, uploaded.length, ...next);
        setVideoClips([...uploaded]);
      }
      setProcessingPhase('processing');
      const result = await api.posts.composeVideo({
        clips: uploaded.map((clip) => ({
          objectPath: clip.objectPath!, duration: clip.duration,
          speed: clip.speed, filter: clip.filter,
        })),
        trimStart, trimEnd,
      });
      setComposedVideo(result);
      setVideoClips(uploaded.map(({ objectPath: _op, ...clip }) => clip));
      setScrubTime(0); setPreviewSeekTime(0); setProcessingPhase('ready');
    } catch (error) {
      setVideoClips([...uploaded]);
      setProcessingPhase('error');
      setProcessingError(error instanceof Error ? error.message : 'Video processing failed. Tap retry to keep working with these clips.');
    }
  }

  if (loadingEdit) {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[ts.muted, { marginTop: 12, fontSize: FS.sm }]}>Loading post...</Text>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN A: MEDIA PICK — full-screen black, bottom sheet row
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'media-pick') {
    const DURATIONS: MaxVideoDuration[] = [10, 15, 30, 60];

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* Floating header */}
        <View style={[ts.floatingHeader, { paddingTop: topPad + 8 }]}>
          <TouchableOpacity onPress={() => haptic(leaveSetupDestination)} style={ts.headerIconBtn}>
            <Feather name="x" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={ts.headerTitle}>
            {isBuyer ? 'Add to Story' : editId ? 'Edit Post' : 'New Post'}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Main area — either empty/purpose or media preview */}
        <View style={ts.mediaPad}>
          {!hasMedia && (
            <View style={ts.emptyMedia}>
              {/* Text-only purpose chips for sellers */}
              {!isBuyer && (
                <View style={ts.purposeSection}>
                  <Text style={ts.purposeSectionLabel}>Text-only post</Text>
                  <View style={ts.purposeChipRow}>
                    {PURPOSE_CHIPS.map((chip) => {
                      const active = activePurpose?.label === chip.label;
                      return (
                        <TouchableOpacity
                          key={chip.label}
                          style={[ts.purposeChip, active && { backgroundColor: chip.color + '25', borderColor: chip.color + '60' }]}
                          activeOpacity={0.8}
                          onPress={() => { Haptics.selectionAsync(); setActivePurpose(active ? null : chip); }}
                        >
                          <Feather name={chip.icon} size={14} color={active ? chip.color : MUTED} />
                          <Text style={[ts.purposeChipText, active && { color: chip.color }]}>{chip.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Video preview in media-pick (full-frame 9:16 crop) */}
          {videoClips.length > 0 && (
            <View style={ts.mediaPickPreview}>
              <FullVideoPreview uri={videoClips[0].uri} />
              {/* Replace overlay */}
              <TouchableOpacity style={ts.replaceOverlay} onPress={pickFromLibrary} activeOpacity={0.8}>
                <Feather name="refresh-cw" size={14} color={FG} />
                <Text style={ts.replaceOverlayText}>Replace</Text>
              </TouchableOpacity>
              {/* Duration chips overlay */}
              <View style={ts.durationOverlay}>
                {DURATIONS.map((d) => {
                  const sel = maxDuration === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[ts.durationChip, sel && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                      onPress={() => { Haptics.selectionAsync(); setMaxDuration(d); }}
                    >
                      <Text style={[ts.durationChipText, sel && { color: '#000' }]}>{d}s</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Photo strip in media-pick */}
          {slidePhotos.length > 0 && (
            <View style={ts.mediaPickPreview}>
              {/* Show first photo large */}
              <Image source={{ uri: slidePhotos[0].uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              {/* Strip of remaining thumbnails bottom */}
              <View style={ts.photoStripOverlay}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 6, padding: 6 }}>
                    {slidePhotos.map((photo, idx) => (
                      <View key={photo.id} style={ts.photoThumb}>
                        <Image source={{ uri: photo.uri }} style={ts.photoThumbImg} resizeMode="cover" />
                        <TouchableOpacity
                          style={ts.removeChip}
                          onPress={() => setSlidePhotos(prev => prev.filter(p => p.id !== photo.id))}
                        >
                          <Feather name="x" size={10} color={FG} />
                        </TouchableOpacity>
                        {idx === 0 && (
                          <View style={ts.coverLabel}><Text style={ts.coverLabelText}>Cover</Text></View>
                        )}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
              {/* Replace overlay */}
              <TouchableOpacity style={ts.replaceOverlay} onPress={pickFromLibrary} activeOpacity={0.8}>
                <Feather name="plus" size={14} color={FG} />
                <Text style={ts.replaceOverlayText}>Add more</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Bottom sheet — upload / camera / type badge */}
        <View style={[ts.bottomSheet, { paddingBottom: botPad + 8 }]}>
          {/* Action row */}
          <View style={ts.bottomActionRow}>
            <TouchableOpacity
              style={ts.bottomActionBtn}
              activeOpacity={0.8}
              onPress={pickFromLibrary}
            >
              <View style={[ts.bottomActionIcon, { backgroundColor: '#1C1C1E' }]}>
                <Feather name="image" size={22} color={FG} />
              </View>
              <Text style={ts.bottomActionLabel}>Upload</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={ts.bottomActionBtn}
              activeOpacity={0.8}
              onPress={() => router.push((`/camera-capture?maxDuration=${maxDuration}`) as never)}
            >
              <View style={[ts.bottomActionIcon, { backgroundColor: FG }]}>
                <Feather name="camera" size={22} color={BG} />
              </View>
              <Text style={ts.bottomActionLabel}>Camera</Text>
            </TouchableOpacity>

            {!isBuyer && !hasMedia && (
              <TouchableOpacity
                style={ts.bottomActionBtn}
                activeOpacity={0.8}
                onPress={() => setActivePurpose(activePurpose ? null : PURPOSE_CHIPS[0])}
              >
                <View style={[ts.bottomActionIcon, { backgroundColor: '#1C1C1E' }]}>
                  <Feather name="type" size={22} color={FG} />
                </View>
                <Text style={ts.bottomActionLabel}>Text</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Type badge if media selected */}
          {hasMedia && (
            <View style={ts.typeBadgeRow}>
              <View style={[ts.typeBadge, { borderColor: PURPLE + '55' }]}>
                <Feather
                  name={videoClips.length > 0 ? 'video' : slidePhotos.length > 1 ? 'layers' : 'image'}
                  size={12} color={PURPLE}
                />
                <Text style={[ts.typeBadgeText, { color: PURPLE }]}>
                  {videoClips.length > 0
                    ? 'Video'
                    : slidePhotos.length > 1
                    ? `Slideshow (${slidePhotos.length})`
                    : 'Photo'}
                </Text>
              </View>
            </View>
          )}

          {/* Next button */}
          <TouchableOpacity
            style={[ts.nextBtn, !canProceed && { opacity: 0.35 }]}
            activeOpacity={0.85}
            disabled={!canProceed}
            onPress={() => haptic(() => setStep(videoClips.length > 0 ? 'video-edit' : 'post-details'))}
          >
            <LinearGradient
              colors={canProceed ? theme.primaryGradient : ['#333', '#333']}
              style={ts.nextBtnGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              <Text style={[ts.nextBtnText, { color: canProceed ? theme.onAccent : MUTED }]}>
                {videoClips.length > 0 ? 'Next' : 'Next'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {!canProceed && (
            <Text style={ts.hintText}>
              {isBuyer ? 'Add a photo or video to continue' : 'Add media or select a post type'}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN B: VIDEO EDIT — full-screen preview, floating right toolbar
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'video-edit') {
    const busy         = processingPhase === 'uploading' || processingPhase === 'processing';
    const previewClip  = videoClips[Math.min(previewClipIndex, Math.max(0, videoClips.length - 1))];
    const previewUri   = composedVideo?.mediaUrl ?? previewClip?.uri;

    const seekFromLocation = (locationX: number) => {
      const width = Math.max(1, timelineWidthRef.current);
      const rangeStart = composedVideo ? 0 : trimStart;
      const rangeEnd   = composedVideo ? composedVideo.duration : trimEnd;
      const next = rangeStart + Math.max(0, Math.min(1, locationX / width)) * Math.max(0.1, rangeEnd - rangeStart);
      setScrubTime(next);
      if (composedVideo) { setPreviewSeekTime(next); return; }
      let elapsed = 0;
      for (let idx = 0; idx < videoClips.length; idx += 1) {
        const od = videoClips[idx].duration / videoClips[idx].speed;
        if (next <= elapsed + od || idx === videoClips.length - 1) {
          setPreviewClipIndex(idx);
          setPreviewSeekTime(Math.max(0, next - elapsed) * videoClips[idx].speed);
          break;
        }
        elapsed += od;
      }
    };

    return (
      <View style={[ts.root, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />

        {/* Full-screen video */}
        {previewUri ? (
          <FullVideoPreview
            uri={previewUri}
            seekTime={previewSeekTime}
            playbackRate={composedVideo ? 1 : (previewClip?.speed ?? 1)}
          />
        ) : null}

        {/* Top bar */}
        <View style={[ts.videoTopBar, { paddingTop: topPad + 6 }]}>
          <TouchableOpacity
            disabled={busy}
            onPress={() => haptic(() => setStep('media-pick'))}
            style={ts.videoTopBtn}
          >
            <Feather name="arrow-left" size={24} color={busy ? MUTED : FG} />
          </TouchableOpacity>

          {/* Sound pill */}
          {selectedSound ? (
            <TouchableOpacity
              style={ts.soundPill}
              onPress={() => setShowSoundModal(true)}
              activeOpacity={0.85}
            >
              <Feather name="music" size={13} color={FG} style={{ marginRight: 6 }} />
              <Text style={ts.soundPillText} numberOfLines={1}>
                {selectedSound.soundTitle}
              </Text>
              <TouchableOpacity onPress={() => setSelectedSound(null)} style={{ marginLeft: 8 }}>
                <Feather name="x" size={13} color={MUTED} />
              </TouchableOpacity>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={ts.soundPill} onPress={() => setShowSoundModal(true)} activeOpacity={0.85}>
              <Feather name="music" size={13} color={FG} style={{ marginRight: 6 }} />
              <Text style={ts.soundPillText}>Add sound</Text>
            </TouchableOpacity>
          )}

          <View style={{ width: 44 }} />
        </View>

        {/* Right floating toolbar */}
        <View style={[ts.rightToolbar, { paddingTop: topPad + 56 }]}>
          <ToolBtn icon="settings" onPress={() => {}} />
          <View style={ts.toolDivider} />
          <ToolBtn icon="sliders" />
          <ToolBtn icon="film" />
          <ToolBtn icon="type" onPress={() => setShowSoundModal(true)} />
        </View>

        {/* Timeline + trim overlay at middle-bottom */}
        <View style={[ts.timelinePanel, { paddingBottom: botPad + 100 }]}>
          <View style={ts.timelineMeta}>
            <Text style={ts.timelineMetaText}>
              {videoClips.length} clip{videoClips.length === 1 ? '' : 's'}
            </Text>
            <Text style={ts.timelineMetaText}>
              {(composedVideo?.duration ?? (trimEnd - trimStart)).toFixed(1)}s
            </Text>
          </View>
          <Pressable
            style={ts.timeline}
            onLayout={(e) => { timelineWidthRef.current = e.nativeEvent.layout.width; }}
            onPress={(e)      => seekFromLocation(e.nativeEvent.locationX)}
            onTouchMove={(e)  => seekFromLocation(e.nativeEvent.touches[0]?.locationX ?? 0)}
          >
            {videoClips.map((clip, idx) => (
              <View
                key={clip.id}
                style={[
                  ts.timelineClip,
                  { flex: Math.max(0.05, (clip.duration / clip.speed) / Math.max(0.1, totalVideoDuration)),
                    backgroundColor: idx % 2 === 0 ? PURPLE : '#555' },
                ]}
              >
                <Text style={ts.timelineClipText}>{idx + 1}</Text>
              </View>
            ))}
            <View
              pointerEvents="none"
              style={[ts.scrubber, {
                left: `${Math.max(0, Math.min(100, (scrubTime / Math.max(0.1, composedVideo?.duration ?? totalVideoDuration)) * 100))}%` as any,
              }]}
            />
          </Pressable>
          {/* Trim controls */}
          <View style={ts.trimRow}>
            <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart - 0.5, trimEnd)}>
              <Feather name="minus" size={12} color={FG} /><Text style={ts.trimBtnText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart + 0.5, trimEnd)}>
              <Feather name="plus" size={12} color={FG} /><Text style={ts.trimBtnText}>Start</Text>
            </TouchableOpacity>
            <View style={ts.trimSpacer} />
            <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart, trimEnd - 0.5)}>
              <Feather name="minus" size={12} color={FG} /><Text style={ts.trimBtnText}>End</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ts.trimBtn} disabled={busy} onPress={() => updateTrim(trimStart, trimEnd + 0.5)}>
              <Feather name="plus" size={12} color={FG} /><Text style={ts.trimBtnText}>End</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Processing status */}
        {busy && (
          <View style={ts.processingBanner}>
            <ActivityIndicator size="small" color={PURPLE} />
            <Text style={ts.processingBannerText}>
              {processingPhase === 'uploading' ? 'Uploading...' : 'Processing...'}
            </Text>
          </View>
        )}
        {processingError && !busy && (
          <View style={ts.errorBanner}>
            <Feather name="alert-circle" size={15} color={ORANGE} />
            <Text style={ts.errorBannerText} numberOfLines={2}>{processingError}</Text>
          </View>
        )}
        {composedVideo && !busy && (
          <View style={ts.readyBanner}>
            <Feather name="check-circle" size={15} color={PURPLE} />
            <Text style={ts.readyBannerText}>Ready · {composedVideo.duration.toFixed(1)}s</Text>
          </View>
        )}

        {/* Bottom CTA */}
        <View style={[ts.videoBottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={[ts.nextBtn, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={() => {
              if (composedVideo) setStep('post-details');
              else void processVideo();
            }}
          >
            <LinearGradient
              colors={busy ? ['#333','#333'] : theme.primaryGradient}
              style={ts.nextBtnGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {busy
                ? <ActivityIndicator size="small" color={theme.onAccent} />
                : (
                  <Text style={[ts.nextBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                    {processingPhase === 'error' ? 'Retry' : composedVideo ? 'Next' : 'Process'}
                  </Text>
                )
              }
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <SoundModal
          visible={showSoundModal} onClose={() => setShowSoundModal(false)}
          soundTab={soundTab} setSoundTab={setSoundTab}
          soundSearch={soundSearch} setSoundSearch={setSoundSearch}
          onUse={useSound} insets={insets}
        />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCREEN C: POST DETAILS — caption+thumbnail, settings rows, dual CTA
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'post-details') {
    const ct = inferContentType();

    // Thumbnail source
    const thumbUri = composedVideo?.thumbnailUrl
      ?? (slidePhotos.length > 0 ? slidePhotos[0].uri : null);
    const hasVideo = videoClips.length > 0;

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[ts.root, { backgroundColor: BG_SOFT }]}>
          <StatusBar barStyle="light-content" backgroundColor={BG_SOFT} />

          {/* Header */}
          <View style={[ts.detailsHeader, { paddingTop: topPad + 4 }]}>
            <TouchableOpacity
              onPress={() => haptic(() => setStep(videoClips.length > 0 ? 'video-edit' : 'media-pick'))}
              style={ts.headerIconBtn}
            >
              <Feather name="arrow-left" size={24} color={FG} />
            </TouchableOpacity>
            <Text style={ts.headerTitle}>{editId ? 'Edit Post' : 'Post'}</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Caption + thumbnail row */}
            <View style={ts.captionRow}>
              <TextInput
                style={ts.captionInput}
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={2200}
                placeholder="Write a caption..."
                placeholderTextColor={MUTED}
                textAlignVertical="top"
              />
              {/* Thumbnail */}
              <View style={ts.thumbContainer}>
                {hasVideo && videoClips[0]?.uri ? (
                  <ThumbVideoPreview uri={videoClips[0].uri} />
                ) : thumbUri ? (
                  <Image source={{ uri: thumbUri }} style={ts.thumbImg} resizeMode="cover" />
                ) : (
                  <View style={ts.thumbPlaceholder}>
                    <Feather name="image" size={20} color={MUTED} />
                  </View>
                )}
                <TouchableOpacity
                  style={ts.thumbEditOverlay}
                  onPress={() => haptic(() => setStep(videoClips.length > 0 ? 'video-edit' : 'media-pick'))}
                  activeOpacity={0.8}
                >
                  <Text style={ts.thumbEditText}>Edit cover</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Char count */}
            <Text style={[ts.muted, { fontSize: 11, textAlign: 'right', paddingHorizontal: 16, marginTop: 4 }]}>
              {caption.length} / 2200
            </Text>

            {/* Hashtag + mention pills */}
            <View style={ts.pillRow}>
              <TouchableOpacity
                style={ts.pill}
                onPress={() => {
                  if (hashtagInput.trim().length > 1) addHashtag(hashtagInput);
                  else setHashtagInput('#');
                }}
              >
                <Feather name="hash" size={14} color={FG} style={{ marginRight: 6 }} />
                <Text style={ts.pillText}>Hashtags</Text>
              </TouchableOpacity>
              {!isBuyer && (
                <TouchableOpacity style={ts.pill} onPress={() => setShowProductModal(true)}>
                  <Feather name="tag" size={14} color={FG} style={{ marginRight: 6 }} />
                  <Text style={ts.pillText}>Tag products</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Hashtag input (visible) */}
            {(hashtagInput.length > 0 || hashtags.length > 0) && (
              <View style={ts.hashtagSection}>
                <TextInput
                  style={ts.hashtagInput}
                  value={hashtagInput}
                  onChangeText={setHashtagInput}
                  placeholder="#add tag..."
                  placeholderTextColor={MUTED}
                  returnKeyType="done"
                  onSubmitEditing={() => { if (hashtagInput.trim().length > 1) addHashtag(hashtagInput); }}
                  blurOnSubmit={false}
                  autoCapitalize="none"
                />
                {hashtags.length > 0 && (
                  <View style={ts.tagWrap}>
                    {hashtags.map((h) => (
                      <TouchableOpacity
                        key={h.tag}
                        style={ts.tagChip}
                        onPress={() => setHashtags(prev => prev.filter(hh => hh.tag !== h.tag))}
                      >
                        <Text style={ts.tagChipText}>{h.tag}</Text>
                        <Feather name="x" size={10} color={PURPLE} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Product tags */}
            {!isBuyer && productTags.length > 0 && (
              <View style={[ts.hashtagSection, { paddingTop: 0 }]}>
                <View style={ts.tagWrap}>
                  {productTags.map((pt) => (
                    <View key={pt.productId} style={[ts.tagChip, { backgroundColor: PURPLE + '18', borderColor: PURPLE + '40' }]}>
                      <Text style={[ts.tagChipText, { color: FG }]}>{pt.productName}</Text>
                      <TouchableOpacity onPress={() => setProductTags(prev => prev.filter(t => t.productId !== pt.productId))}>
                        <Feather name="x" size={10} color={MUTED} style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Purpose chips (sellers) */}
            {!isBuyer && (
              <View style={ts.sectionBlock}>
                <Text style={ts.sectionLabel}>Content type (optional)</Text>
                <View style={ts.purposeChipRow}>
                  {PURPOSE_CHIPS.map((chip) => {
                    const active = activePurpose?.label === chip.label;
                    return (
                      <TouchableOpacity
                        key={chip.label}
                        style={[ts.purposeChip, active && { backgroundColor: chip.color + '25', borderColor: chip.color + '60' }]}
                        activeOpacity={0.8}
                        onPress={() => { Haptics.selectionAsync(); setActivePurpose(active ? null : chip); }}
                      >
                        <Feather name={chip.icon} size={13} color={active ? chip.color : MUTED} />
                        <Text style={[ts.purposeChipText, active && { color: chip.color }]}>{chip.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Sound */}
            {!isBuyer && (
              <View style={ts.settingsSeparator} />
            )}
            {!isBuyer && (
              selectedSound ? (
                <View style={ts.soundRow}>
                  <Feather name="music" size={16} color={PURPLE} />
                  <Text style={ts.soundRowText} numberOfLines={1}>
                    {selectedSound.soundTitle} — {selectedSound.artist}
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedSound(null)}>
                    <Feather name="x" size={16} color={MUTED} />
                  </TouchableOpacity>
                </View>
              ) : (
                <SettingsRow label="Add sound" onPress={() => setShowSoundModal(true)} />
              )
            )}

            {/* Divider */}
            <View style={ts.settingsSeparator} />

            {/* Location */}
            <View style={ts.settingsRow}>
              <Feather name="map-pin" size={16} color={MUTED} style={{ marginRight: 10 }} />
              <TextInput
                style={ts.locationInput}
                value={location}
                onChangeText={setLocation}
                placeholder="Add location"
                placeholderTextColor={MUTED}
              />
            </View>

            <View style={ts.settingsSeparator} />

            {/* Visibility */}
            <SettingsRow
              label="Who can view this post"
              value={visibility.isPublic ? 'Everyone' : 'Followers'}
              onPress={() => setVisibility(prev => ({ ...prev, isPublic: !prev.isPublic }))}
            />

            <View style={ts.settingsSeparator} />

            {/* More settings */}
            <View style={ts.sectionBlock}>
              <Text style={ts.sectionLabel}>Settings</Text>
              {([
                { label: 'Allow comments', key: 'allowComments' as const },
                { label: 'Allow reposts',  key: 'allowReposts'  as const },
                { label: 'Show like count', key: 'showLikeCount' as const },
              ]).map(({ label, key }) => (
                <View key={key} style={ts.toggleRow}>
                  <Text style={ts.toggleLabel}>{label}</Text>
                  <Switch
                    value={visibility[key] as boolean}
                    onValueChange={(v) => setVisibility(prev => ({ ...prev, [key]: v }))}
                    thumbColor={(visibility[key] as boolean) ? PURPLE : '#555'}
                    trackColor={{ false: '#333', true: PURPLE + '44' }}
                  />
                </View>
              ))}
            </View>

            <View style={ts.settingsSeparator} />

            {/* Schedule */}
            <View style={ts.sectionBlock}>
              <Text style={ts.sectionLabel}>Schedule</Text>
              <View style={ts.scheduleRow}>
                {(['now', 'schedule'] as const).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={[ts.schedulePill, scheduleMode === mode && { backgroundColor: PURPLE + '22', borderColor: PURPLE + '55' }]}
                    onPress={() => setScheduleMode(mode)}
                  >
                    {scheduleMode === mode && <Feather name="check" size={11} color={PURPLE} style={{ marginRight: 4 }} />}
                    <Text style={[ts.schedulePillText, scheduleMode === mode && { color: PURPLE }]}>
                      {mode === 'now' ? 'Publish now' : 'Schedule'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {scheduleMode === 'schedule' && (
                <TextInput
                  style={[ts.inlineInput, { marginTop: 10 }]}
                  value={scheduledDateInput}
                  onChangeText={(v) => { setScheduledDateInput(v); setScheduledAt(v); }}
                  placeholder="YYYY-MM-DD HH:MM"
                  placeholderTextColor={MUTED}
                />
              )}
            </View>
          </ScrollView>

          {/* Dual CTA bottom bar — Drafts | Post */}
          <View style={[ts.dualCTA, { paddingBottom: botPad + 8 }]}>
            <TouchableOpacity
              style={ts.draftBtn}
              activeOpacity={0.8}
              onPress={async () => {
                haptic(() => {});
                try {
                  await persistSellerPost(true);
                  Alert.alert('Draft saved', 'Your draft has been saved.', [{ text: 'OK', onPress: leaveSetupDestination }]);
                } catch (error) {
                  Alert.alert('Draft not saved', error instanceof Error ? error.message : 'Could not save draft.');
                }
              }}
            >
              <Feather name="bookmark" size={15} color={FG} style={{ marginRight: 6 }} />
              <Text style={ts.draftBtnText}>Drafts</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[ts.postBtn, isPublishing && { opacity: 0.55 }]}
              activeOpacity={0.85}
              disabled={isPublishing}
              onPress={async () => {
                haptic(() => {});
                if (isPublishing) return;
                if (scheduleMode === 'schedule') {
                  const t = scheduledAt ? new Date(scheduledAt).getTime() : Number.NaN;
                  if (!Number.isFinite(t) || t <= Date.now()) {
                    Alert.alert('Choose a future time', 'Enter a valid date and time in the future before scheduling.');
                    return;
                  }
                }
                setIsPublishing(true);
                setStep('publishing');
                try {
                  if (editId) {
                    await persistSellerPost(false);
                  } else {
                    await completeSetupTaskAfter('first_post', () => persistSellerPost(false));
                  }
                  setStep('done');
                } catch (error) {
                  setStep('post-details');
                  Alert.alert('Publish failed', error instanceof Error ? error.message : 'Something went wrong.');
                } finally {
                  setIsPublishing(false);
                }
              }}
            >
              <LinearGradient
                colors={theme.primaryGradient}
                style={ts.postBtnGrad}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                {isPublishing
                  ? <ActivityIndicator size="small" color={theme.onAccent} />
                  : (
                    <>
                      <Feather name="send" size={15} color={theme.onAccent} style={{ marginRight: 6 }} />
                      <Text style={[ts.postBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>
                        {scheduleMode === 'schedule' ? 'Schedule' : editId ? 'Save' : 'Post'}
                      </Text>
                    </>
                  )
                }
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <ProductModal
            visible={showProductModal} onClose={() => setShowProductModal(false)}
            productSearch={productSearch} setProductSearch={setProductSearch}
            productTags={productTags} onTag={tagProduct}
            taggableProducts={taggableProducts}
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Publishing screen
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'publishing') {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <LinearGradient
            colors={theme.primaryGradient}
            style={ts.publishingCircle}
          >
            <Feather name="upload-cloud" size={36} color={theme.onAccent} />
          </LinearGradient>
        </Animated.View>
        <Text style={[ts.doneTitle, { marginTop: 28 }]}>Publishing...</Text>
        <Text style={ts.doneSub}>Preparing your content</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Done screen
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={[ts.root, ts.center, { backgroundColor: BG, paddingBottom: botPad }]}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <LinearGradient colors={theme.primaryGradient} style={ts.publishingCircle}>
          <Feather name="check" size={40} color={theme.onAccent} />
        </LinearGradient>
        <Text style={ts.doneTitle}>
          {editId ? 'Post updated' : scheduleMode === 'schedule' ? 'Scheduled' : 'Posted'}
        </Text>
        <Text style={ts.doneSub}>
          {scheduleMode === 'schedule'
            ? 'Your post will go live at the scheduled time.'
            : 'Your post is live on your profile.'}
        </Text>
        <TouchableOpacity
          style={[ts.nextBtn, { marginTop: 32, alignSelf: 'stretch', marginHorizontal: 32 }]}
          activeOpacity={0.85}
          onPress={() => haptic(() => router.replace((isSellerSetup ? SELLER_HOME_ROUTE : '/(tabs)/profile') as never))}
        >
          <LinearGradient colors={theme.primaryGradient} style={ts.nextBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={[ts.nextBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>View Profile</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ts.draftBtn, { marginTop: 14, alignSelf: 'center', paddingHorizontal: 32 }]}
          activeOpacity={0.8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); resetAll(); }}
        >
          <Text style={ts.draftBtnText}>Create Another</Text>
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
  const colors = useColors();
  const PURPLE = colors.primary;
  const tabs = [
    { id: 'trending'    as const, label: 'Trending' },
    { id: 'saved'       as const, label: 'Saved'    },
    { id: 'recent'      as const, label: 'Recent'   },
    { id: 'original'    as const, label: 'Original' },
    { id: 'royalty_free'as const, label: 'Free'     },
  ];
  const filtered: Sound[] = [];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[ms.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={ms.header}>
          <Text style={ms.title}>Sounds</Text>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={ms.searchWrap}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput style={ms.searchInput} value={soundSearch} onChangeText={setSoundSearch} placeholder="Search sounds..." placeholderTextColor={MUTED} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
            {tabs.map((t) => (
              <TouchableOpacity key={t.id} style={[ms.tabPill, soundTab === t.id && { backgroundColor: PURPLE + '22', borderColor: PURPLE + '55' }]} onPress={() => setSoundTab(t.id)}>
                <Text style={[ms.tabText, soundTab === t.id && { color: PURPLE }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Feather name="music" size={32} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 12, fontFamily: FONT.regular, textAlign: 'center', fontSize: FS.sm }}>Sound library coming soon.</Text>
            </View>
          ) : filtered.map((sound) => (
            <View key={sound.id} style={ms.soundRow}>
              <View style={ms.soundIcon}><Feather name="music" size={16} color={PURPLE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={ms.soundTitle}>{sound.title}</Text>
                <Text style={ms.soundArtist}>{sound.artist}</Text>
              </View>
              <Text style={ms.soundDur}>{sound.duration}s</Text>
              <TouchableOpacity style={ms.useBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUse(sound); }}>
                <Text style={ms.useBtnText}>Use</Text>
              </TouchableOpacity>
            </View>
          ))}
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
  insets: { top: number; bottom: number };
}
function ProductModal({ visible, onClose, productSearch, setProductSearch, productTags, onTag, taggableProducts, insets }: ProductModalProps) {
  const colors = useColors();
  const PURPLE = colors.primary;
  const filtered = taggableProducts.filter(p => productSearch === '' || p.name.toLowerCase().includes(productSearch.toLowerCase()));
  const statusColor = (st: string) => st === 'active' ? PURPLE : st === 'scheduled' ? ORANGE : MUTED;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'} onRequestClose={onClose}>
      <View style={[ms.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={ms.header}>
          <Text style={ms.title}>Tag Products</Text>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn}><Feather name="x" size={20} color={FG} /></TouchableOpacity>
        </View>
        {productTags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {productTags.map((pt) => {
                const prod = taggableProducts.find(p => p.id === pt.productId);
                return (
                  <View key={pt.productId} style={ms.taggedChip}>
                    <Text style={ms.taggedChipText}>{pt.productName}</Text>
                    <TouchableOpacity onPress={() => prod && onTag(prod)}>
                      <Feather name="x" size={11} color={PURPLE} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
        <View style={[ms.searchWrap, { marginTop: 8 }]}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput style={ms.searchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor={MUTED} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Feather name="tag" size={32} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 12, fontFamily: FONT.regular, fontSize: FS.sm }}>
                {productSearch ? 'No products match your search' : 'No products available to tag'}
              </Text>
            </View>
          ) : filtered.map((p) => {
            const isTagged = productTags.some(t => t.productId === p.id);
            return (
              <View key={p.id} style={ms.productRow}>
                <View style={ms.productSwatch} />
                <View style={{ flex: 1 }}>
                  <Text style={ms.productName}>{p.name}</Text>
                  <Text style={ms.productPrice}>{formatCents(p.pricing.priceCents)}</Text>
                </View>
                <View style={[ms.statusBadge, { backgroundColor: statusColor(p.status) + '22' }]}>
                  <Text style={[ms.statusBadgeText, { color: statusColor(p.status) }]}>{p.status}</Text>
                </View>
                <TouchableOpacity
                  style={[ms.tagBtn, isTagged && { backgroundColor: PURPLE, borderColor: PURPLE }]}
                  onPress={() => { Haptics.selectionAsync(); onTag(p); }}
                >
                  <Text style={[ms.tagBtnText, isTagged && { color: '#000' }]}>{isTagged ? 'Remove' : 'Tag'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={onClose} style={[ms.doneBtn]}>
            <Text style={ms.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ts = StyleSheet.create({
  root:   { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  // ── Shared header ──
  floatingHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  detailsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  headerIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  // ── Media pick ──
  mediaPad: { flex: 1, marginTop: 80 },
  emptyMedia: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 40 },
  purposeSection: { width: '100%', paddingHorizontal: 24 },
  purposeSectionLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12, textAlign: 'center' },

  mediaPickPreview: { flex: 1, backgroundColor: '#111' },

  photoStripOverlay: {
    position: 'absolute', bottom: 70, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  photoThumb:    { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: 80, height: 80 },
  removeChip:    { position: 'absolute', top: 4, right: 4, backgroundColor: '#00000099', borderRadius: 10, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  coverLabel:    { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#000000AA', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  coverLabelText:{ fontSize: 9, fontFamily: FONT.bold, color: FG },

  replaceOverlay: {
    position: 'absolute', top: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.60)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  replaceOverlayText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  durationOverlay: {
    position: 'absolute', bottom: 14, left: 14,
    flexDirection: 'row', gap: 6,
  },
  durationChip:     { backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  durationChipText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  typeBadgeRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
  typeBadge:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  typeBadgeText:{ fontSize: FS.xs, fontFamily: FONT.semibold },

  // ── Purpose chips ──
  purposeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  purposeChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 9 },
  purposeChipText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  // ── Bottom sheet (media pick) ──
  bottomSheet: {
    paddingHorizontal: 20, paddingTop: 16,
    backgroundColor: BG_SOFT,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
  },
  bottomActionRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 18 },
  bottomActionBtn: { alignItems: 'center', gap: 8 },
  bottomActionIcon:{ width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  bottomActionLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  // ── Next / Post buttons ──
  nextBtn:     { borderRadius: 12, overflow: 'hidden' },
  nextBtnGrad: { paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  nextBtnText: { fontSize: FS.base, fontFamily: FONT.bold },
  hintText:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 10 },

  // ── Video edit ──
  videoTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  videoTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  soundPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(30,30,30,0.85)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, maxWidth: SW * 0.55,
  },
  soundPillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG, flex: 1 },

  rightToolbar: {
    position: 'absolute', right: 12, zIndex: 20,
    alignItems: 'center', gap: 6,
  },
  toolBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  toolBtnLabel:{ fontSize: 10, fontFamily: FONT.regular, color: FG, marginTop: 2 },
  toolDivider: { width: 30, height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginVertical: 4 },

  timelinePanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.70)',
  },
  timelineMeta:     { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginBottom: 6 },
  timelineMetaText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  timeline:         { height: 48, flexDirection: 'row', borderRadius: 8, overflow: 'hidden', backgroundColor: CARD, position: 'relative', marginBottom: 10 },
  timelineClip:     { minWidth: 16, alignItems: 'center', justifyContent: 'center', borderRightWidth: 2, borderRightColor: BG },
  timelineClipText: { color: FG, fontSize: 10, fontFamily: FONT.bold },
  scrubber:         { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1, backgroundColor: FG },
  trimRow:          { flexDirection: 'row', gap: 6, marginBottom: 14 },
  trimBtn:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  trimBtnText:      { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  trimSpacer:       { flex: 1 },

  processingBanner: { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  processingBannerText:{ fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flex: 1 },
  errorBanner:      { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  errorBannerText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE, flex: 1 },
  readyBanner:      { position: 'absolute', bottom: 90, left: 20, right: 20, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(20,20,20,0.90)', borderRadius: 12, padding: 12 },
  readyBannerText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },

  videoBottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
    paddingHorizontal: 20, paddingTop: 8,
    backgroundColor: 'rgba(0,0,0,0.60)',
  },

  // ── Post details ──
  captionRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingTop: 16, gap: 12,
  },
  captionInput: {
    flex: 1, minHeight: 90, color: FG,
    fontFamily: FONT.regular, fontSize: FS.sm,
    textAlignVertical: 'top',
  },
  thumbContainer: { width: 80, height: 100, borderRadius: 8, overflow: 'hidden', backgroundColor: CARD },
  thumbImg:       { width: '100%', height: '100%' },
  thumbPlaceholder:{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  thumbEditOverlay:{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', paddingVertical: 5 },
  thumbEditText:  { fontSize: 10, fontFamily: FONT.medium, color: FG },

  pillRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER,
  },
  pill:     { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  hashtagSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  hashtagInput:   { color: FG, fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, marginBottom: 10 },
  tagWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip:        { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  tagChipText:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  sectionBlock: { paddingHorizontal: 16, paddingVertical: 14 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },

  settingsSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginHorizontal: 16 },
  settingsRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  settingsRowLabel:  { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  settingsRowRight:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  settingsRowValue:  { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  soundRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  soundRowText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  locationInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  toggleLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  scheduleRow:     { flexDirection: 'row', gap: 10 },
  schedulePill:    { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 8 },
  schedulePillText:{ fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  inlineInput:     { backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: 12, paddingVertical: 10 },

  // ── Dual CTA ──
  dualCTA: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
    backgroundColor: BG_SOFT,
  },
  draftBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  draftBtnText: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  postBtn:      { flex: 1, borderRadius: 12, overflow: 'hidden' },
  postBtnGrad:  { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  postBtnText:  { fontSize: FS.base, fontFamily: FONT.bold },

  // ── Publishing / done ──
  publishingCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  doneTitle:        { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginTop: 20 },
  doneSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: 8, paddingHorizontal: 40 },

  muted: { fontFamily: FONT.regular, color: MUTED },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────
const ms = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG_SOFT },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  title:   { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  closeBtn:{ width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  searchWrap:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10, marginHorizontal: 16, marginTop: 12 },
  searchInput:{ flex: 1, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  tabPill:  { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tabText:  { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  soundRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, gap: 10 },
  soundIcon:{ width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  soundTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  soundArtist:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  soundDur: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  useBtn:   { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  useBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  taggedChip:{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  taggedChipText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  productRow:{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER, gap: 10 },
  productSwatch:{ width: 40, height: 40, borderRadius: 8, backgroundColor: CARD },
  productName:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  productPrice:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  statusBadge:{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText:{ fontSize: FS.xs, fontFamily: FONT.semibold },
  tagBtn:    { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tagBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED },
  doneBtn:   { borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, alignItems: 'center' },
  doneBtnText:{ fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
});

// ─── Create Post Screen ────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Modal, Animated, Dimensions, Platform,
  ActivityIndicator, Alert, KeyboardAvoidingView, Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { DEMO_SOUNDS, SUGGESTED_HASHTAGS } from '@/services/sellerContent';
import { getTaggableProducts } from '@/services/productService';
import { createSellerPost } from '@/services/socialService';
import type { Product } from '@/services/productTypes';
import type {
  Sound, PostProductTag, PostHashtag, PostVisibility,
  AspectRatio, MaxVideoDuration, ContentType, TransitionStyle,
} from '@/services/types';

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const ORANGE = '#F97316';
const CYAN   = '#06B6D4';
const ERR    = '#F87171';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// ─── Types ────────────────────────────────────────────────────────────────────
type Step =
  | 'type-select' | 'video-pick' | 'video-duration' | 'video-edit'
  | 'slide-pick' | 'slide-ratio' | 'slide-edit' | 'post-details'
  | 'publishing' | 'done';

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

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic: true,
  allowComments: true,
  allowReposts: true,
  showLikeCount: true,
};

// ─── Video player wrapper ─────────────────────────────────────────────────────
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  const PREVIEW_W = screenWidth;
  const PREVIEW_H = Math.min(PREVIEW_W * 16 / 9, screenHeight * 0.55);
  return (
    <VideoView
      player={player}
      style={{ width: PREVIEW_W, height: PREVIEW_H }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CreatePostScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const _params = useLocalSearchParams();

  // ── Step & content ──
  const [step, setStep] = useState<Step>('type-select');
  const [contentType, setContentType] = useState<ContentType | null>(null);

  // ── Video ──
  const [videoClips, setVideoClips] = useState<VideoClipLocal[]>([]);
  const [maxDuration, setMaxDuration] = useState<MaxVideoDuration>(30);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.5 | 1 | 1.5 | 2>(1);
  const [isPlaying, setIsPlaying] = useState(true);

  // ── Sound ──
  const [selectedSound, setSelectedSound] = useState<SoundSelection | null>(null);
  const [originalAudioVol, setOriginalAudioVol] = useState(1);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(false);

  // ── Text overlays ──
  const [overlayTexts, setOverlayTexts] = useState<OverlayText[]>([]);

  // ── Products ──
  const [productTags, setProductTags] = useState<PostProductTag[]>([]);

  // ── Slideshow ──
  const [slidePhotos, setSlidePhotos] = useState<SlidePhotoLocal[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [transition, setTransition] = useState<TransitionStyle>('fade');
  const [slideDuration, setSlideDuration] = useState(3);

  // ── Post details ──
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState<PostHashtag[]>([]);
  const [location, setLocation] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>(DEFAULT_VISIBILITY);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduledDateInput, setScheduledDateInput] = useState('');

  // ── Modals ──
  const [showSoundModal, setShowSoundModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);

  // ── Publishing ──
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Sound modal state ──
  const [soundTab, setSoundTab] = useState<'trending' | 'saved' | 'recent' | 'original' | 'royalty_free'>('trending');
  const [soundSearch, setSoundSearch] = useState('');

  // ── Text modal state ──
  const [newTextInput, setNewTextInput] = useState('');
  const [newTextColor, setNewTextColor] = useState('#FFFFFF');
  const [newTextSize, setNewTextSize] = useState(24);

  // ── Product modal state ──
  const [productSearch, setProductSearch] = useState('');

  // ── Taggable products ──
  const [taggableProducts, setTaggableProducts] = useState<Product[]>([]);

  // ── Hashtag input ──
  const [hashtagInput, setHashtagInput] = useState('');

  // ── Animation for publishing ──
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const botPad = Platform.OS === 'web' ? 20 : insets.bottom;

  // ─── Load taggable products on mount ─────────────────────────────────────
  useEffect(() => {
    getTaggableProducts().then(setTaggableProducts).catch(() => {});
  }, []);

  // ─── Publishing animation (animation only — actual save happens in handlePublishNow) ──
  useEffect(() => {
    if (step === 'publishing') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => { loop.stop(); };
    }
  }, [step]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function hapticNav(fn: () => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  }

  function resetAll() {
    setStep('type-select');
    setContentType(null);
    setVideoClips([]);
    setMaxDuration(30);
    setTrimStart(0);
    setTrimEnd(30);
    setIsMuted(false);
    setPlaybackSpeed(1);
    setIsPlaying(true);
    setSelectedSound(null);
    setOriginalAudioVol(1);
    setBeatSyncEnabled(false);
    setOverlayTexts([]);
    setProductTags([]);
    setSlidePhotos([]);
    setAspectRatio('9:16');
    setTransition('fade');
    setSlideDuration(3);
    setCaption('');
    setHashtags([]);
    setLocation('');
    setVisibility(DEFAULT_VISIBILITY);
    setScheduledAt(null);
    setScheduleMode('now');
    setScheduledDateInput('');
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow access to your media library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      setVideoClips(prev => [...prev, {
        uri: asset.uri,
        duration: asset.duration ?? 0,
        id: `clip-${Date.now()}`,
      }]);
    }
  }

  async function pickPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please allow access to your media library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
    });
    if (!result.canceled) {
      const newPhotos: SlidePhotoLocal[] = result.assets.map((a, i) => ({
        uri: a.uri,
        id: `slide-${Date.now()}-${i}`,
      }));
      setSlidePhotos(prev => [...prev, ...newPhotos]);
    }
  }

  function addHashtag(raw: string) {
    const tag = raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`;
    if (tag.length > 1 && !hashtags.find(h => h.tag === tag)) {
      setHashtags(prev => [...prev, { tag }]);
    }
    setHashtagInput('');
  }

  function removeHashtag(tag: string) {
    setHashtags(prev => prev.filter(h => h.tag !== tag));
  }

  function useSound(sound: Sound) {
    setSelectedSound({
      soundId: sound.id,
      soundTitle: sound.title,
      artist: sound.artist,
      startTime: 0,
      volume: 1,
    });
    setShowSoundModal(false);
  }

  function addText() {
    if (!newTextInput.trim()) return;
    setOverlayTexts(prev => [...prev, {
      id: `txt-${Date.now()}`,
      text: newTextInput.trim(),
      color: newTextColor,
      fontSize: newTextSize,
    }]);
    setNewTextInput('');
    setNewTextColor('#FFFFFF');
    setNewTextSize(24);
    setShowTextModal(false);
  }

  function tagProduct(p: Product) {
    const already = productTags.find(t => t.productId === p.id);
    if (already) {
      setProductTags(prev => prev.filter(t => t.productId !== p.id));
    } else {
      setProductTags(prev => [...prev, {
        productId: p.id,
        productName: p.name,
        price: p.pricing.price,
      }]);
    }
  }

  function editStepBack() {
    if (contentType === 'video') return 'video-edit';
    if (contentType === 'slideshow') return 'slide-edit';
    return 'type-select';
  }

  // ─── STEP: type-select ────────────────────────────────────────────────────
  if (step === 'type-select') {
    const types: Array<{
      label: string;
      icon: keyof typeof Feather.glyphMap;
      color: string;
      type: ContentType;
      nextStep: Step;
    }> = [
      { label: 'Video', icon: 'video', color: PURPLE, type: 'video', nextStep: 'video-pick' },
      { label: 'Photo Slideshow', icon: 'layers', color: CYAN, type: 'slideshow', nextStep: 'slide-pick' },
      { label: 'Product Announcement', icon: 'tag', color: GREEN, type: 'announcement', nextStep: 'post-details' },
      { label: 'Drop Announcement', icon: 'bell', color: ORANGE, type: 'countdown', nextStep: 'post-details' },
      { label: 'Behind the Scenes', icon: 'camera', color: '#EC4899', type: 'behind_scenes', nextStep: 'post-details' },
      { label: 'Story', icon: 'circle', color: BLUE, type: 'story', nextStep: 'post-details' },
    ];

    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => router.back())} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Create Post</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={s.typeGrid}>
            {types.map((t) => (
              <TouchableOpacity
                key={t.type}
                style={s.typeCard}
                activeOpacity={0.8}
                onPress={() => hapticNav(() => {
                  setContentType(t.type);
                  setStep(t.nextStep);
                })}
              >
                <View style={[s.typeIconCircle, { backgroundColor: t.color + '22' }]}>
                  <Feather name={t.icon} size={26} color={t.color} />
                </View>
                <Text style={s.typeLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ─── STEP: video-pick ─────────────────────────────────────────────────────
  if (step === 'video-pick') {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('type-select'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Select Video</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Record card */}
          <TouchableOpacity
            style={s.pickCard}
            activeOpacity={0.8}
            onPress={() => Alert.alert('Camera', 'Camera recording is not supported in the simulator. Please upload a video from your library.')}
          >
            <View style={[s.pickIconCircle, { backgroundColor: PURPLE + '22' }]}>
              <Feather name="video" size={28} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pickCardTitle}>Record video</Text>
              <Text style={s.pickCardSub}>Use your camera to shoot</Text>
            </View>
            <Feather name="chevron-right" size={18} color={MUTED} />
          </TouchableOpacity>

          {/* Upload card */}
          <TouchableOpacity
            style={[s.pickCard, { marginTop: 12 }]}
            activeOpacity={0.8}
            onPress={pickVideo}
          >
            <View style={[s.pickIconCircle, { backgroundColor: GREEN + '22' }]}>
              <Feather name="upload" size={28} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pickCardTitle}>Upload from library</Text>
              <Text style={s.pickCardSub}>Choose a video from your device</Text>
            </View>
            <Feather name="chevron-right" size={18} color={MUTED} />
          </TouchableOpacity>

          {/* Selected clips */}
          {videoClips.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.sectionLabel}>Selected clips</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {videoClips.map((clip) => (
                    <View key={clip.id} style={s.clipThumb}>
                      <LinearGradient colors={['#1A0A30', '#0A0820']} style={s.clipGrad}>
                        <Feather name="video" size={20} color={MUTED} />
                        <Text style={s.clipDur}>{clip.duration.toFixed(1)}s</Text>
                      </LinearGradient>
                      <TouchableOpacity
                        style={s.clipRemove}
                        onPress={() => setVideoClips(prev => prev.filter(c => c.id !== clip.id))}
                      >
                        <Feather name="x" size={12} color={FG} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </ScrollView>

        <View style={[s.bottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={[s.nextBtn, videoClips.length === 0 && s.nextBtnDisabled]}
            activeOpacity={0.85}
            disabled={videoClips.length === 0}
            onPress={() => hapticNav(() => setStep('video-duration'))}
          >
            <LinearGradient
              colors={videoClips.length > 0 ? [GREEN, '#20C060'] : [BORDER, BORDER]}
              style={s.nextBtnGrad}
            >
              <Text style={[s.nextBtnText, videoClips.length === 0 && { color: MUTED }]}>Next →</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── STEP: video-duration ─────────────────────────────────────────────────
  if (step === 'video-duration') {
    const durations: MaxVideoDuration[] = [10, 15, 30, 60];
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('video-pick'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Max Duration</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={s.stepSubtitle}>Choose the maximum length for your post.</Text>
          <View style={[s.infoCard, { marginBottom: 24 }]}>
            <Feather name="info" size={14} color={CYAN} style={{ marginRight: 8 }} />
            <Text style={[s.infoCardText, { flex: 1 }]}>
              If your clip is shorter than the selected duration, it will publish at its original length.
            </Text>
          </View>
          <View style={s.durationGrid}>
            {durations.map((d) => {
              const sel = maxDuration === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[s.durationCard, sel && s.durationCardSel]}
                  activeOpacity={0.8}
                  onPress={() => { Haptics.selectionAsync(); setMaxDuration(d); }}
                >
                  <Text style={[s.durationNum, sel && { color: GREEN }]}>{d}s</Text>
                  <Text style={[s.durationLabel, sel && { color: GREEN }]}>
                    {d === 10 ? 'Short' : d === 15 ? 'Standard' : d === 30 ? 'Extended' : 'Long-form'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={s.nextBtn}
            activeOpacity={0.85}
            onPress={() => hapticNav(() => setStep('video-edit'))}
          >
            <LinearGradient colors={[GREEN, '#20C060']} style={s.nextBtnGrad}>
              <Text style={s.nextBtnText}>Next →</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── STEP: video-edit ─────────────────────────────────────────────────────
  if (step === 'video-edit') {
    const PREVIEW_W = screenWidth;
    const PREVIEW_H = Math.min(PREVIEW_W * 16 / 9, screenHeight * 0.55);
    const timelineWidth = screenWidth - 32;
    const trimFraction = (trimEnd - trimStart) / maxDuration;
    const trimLeftFraction = trimStart / maxDuration;

    const tools: Array<{ label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }> = [
      { label: 'Trim', icon: 'scissors', onPress: () => Alert.alert('Trim', 'Trim coming soon') },
      { label: 'Volume', icon: 'volume-2', onPress: () => Alert.alert('Volume', 'Volume coming soon') },
      { label: 'Sound', icon: 'music', onPress: () => setShowSoundModal(true) },
      { label: 'Text', icon: 'type', onPress: () => setShowTextModal(true) },
      { label: 'Product Tag', icon: 'tag', onPress: () => setShowProductModal(true) },
      { label: 'Crop', icon: 'crop', onPress: () => Alert.alert('Crop', 'Crop coming soon') },
      { label: 'Rotate', icon: 'rotate-cw', onPress: () => Alert.alert('Rotate', 'Rotate coming soon') },
      { label: 'Undo', icon: 'rotate-ccw', onPress: () => Alert.alert('Undo', 'Undo coming soon') },
      { label: 'Redo', icon: 'rotate-cw', onPress: () => Alert.alert('Redo', 'Redo coming soon') },
    ];

    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('video-duration'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Edit Video</Text>
          <TouchableOpacity
            onPress={() => hapticNav(() => setStep('post-details'))}
            style={s.doneBtn}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Preview */}
          <View style={{ width: PREVIEW_W, height: PREVIEW_H, backgroundColor: '#0A0820', overflow: 'hidden' }}>
            {videoClips.length > 0 && videoClips[0].uri ? (
              <VideoPreview uri={videoClips[0].uri} />
            ) : (
              <LinearGradient colors={['#1A0A30', '#0A0820']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="video" size={40} color={MUTED} />
                <Text style={{ color: MUTED, marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 13 }}>No video selected</Text>
              </LinearGradient>
            )}
            {!isPlaying && (
              <View style={s.pauseOverlay}>
                <Feather name="play" size={40} color={FG} />
              </View>
            )}
          </View>

          {/* Duration chip */}
          <View style={{ alignItems: 'center', marginTop: 10 }}>
            <View style={s.durChip}>
              <Text style={s.durChipText}>{trimEnd - trimStart}s / {maxDuration}s</Text>
            </View>
          </View>

          {/* Timeline */}
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <View style={{ height: 4, backgroundColor: BORDER, borderRadius: 2 }}>
              <View
                style={{
                  position: 'absolute',
                  left: trimLeftFraction * timelineWidth,
                  width: trimFraction * timelineWidth,
                  height: 4,
                  backgroundColor: GREEN,
                  borderRadius: 2,
                }}
              />
              {/* Trim handles */}
              <TouchableOpacity
                style={[s.trimHandle, { left: trimLeftFraction * timelineWidth - 8 }]}
                onPress={() => {}}
              />
              <TouchableOpacity
                style={[s.trimHandle, { left: (trimLeftFraction + trimFraction) * timelineWidth - 8 }]}
                onPress={() => {}}
              />
            </View>
          </View>

          {/* Controls row */}
          <View style={s.controlsRow}>
            <TouchableOpacity
              style={s.controlBtn}
              onPress={() => setIsPlaying(p => !p)}
            >
              <Feather name={isPlaying ? 'pause' : 'play'} size={20} color={FG} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.controlBtn}
              onPress={() => setIsMuted(m => !m)}
            >
              <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={20} color={FG} />
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {([0.5, 1, 1.5, 2] as Array<0.5 | 1 | 1.5 | 2>).map((sp) => (
                  <TouchableOpacity
                    key={sp}
                    style={[s.speedPill, playbackSpeed === sp && s.speedPillActive]}
                    onPress={() => { Haptics.selectionAsync(); setPlaybackSpeed(sp); }}
                  >
                    <Text style={[s.speedPillText, playbackSpeed === sp && { color: GREEN }]}>{sp}x</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Tool strip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, paddingLeft: 16 }}>
            <View style={{ flexDirection: 'row', gap: 10, paddingRight: 16 }}>
              {tools.map((tool) => (
                <TouchableOpacity key={tool.label} style={s.toolCard} onPress={tool.onPress} activeOpacity={0.8}>
                  <Feather name={tool.icon} size={18} color={FG} />
                  <Text style={s.toolLabel}>{tool.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Selected sound strip */}
          {selectedSound && (
            <View style={s.soundStrip}>
              <Feather name="music" size={14} color={GREEN} />
              <Text style={s.soundStripText} numberOfLines={1}>{selectedSound.soundTitle} – {selectedSound.artist}</Text>
              <TouchableOpacity onPress={() => setSelectedSound(null)}>
                <Feather name="x" size={16} color={MUTED} />
              </TouchableOpacity>
            </View>
          )}

          {/* Beat sync */}
          <View style={s.beatSyncRow}>
            <Feather name="activity" size={14} color={MUTED} />
            <Text style={s.beatSyncLabel}>Beat Sync</Text>
            <Switch
              value={beatSyncEnabled}
              onValueChange={setBeatSyncEnabled}
              thumbColor={beatSyncEnabled ? GREEN : MUTED}
              trackColor={{ false: BORDER, true: GREEN + '44' }}
            />
          </View>
        </ScrollView>

        <SoundModal
          visible={showSoundModal}
          onClose={() => setShowSoundModal(false)}
          soundTab={soundTab}
          setSoundTab={setSoundTab}
          soundSearch={soundSearch}
          setSoundSearch={setSoundSearch}
          onUse={useSound}
          insets={insets}
        />
        <TextModal
          visible={showTextModal}
          onClose={() => setShowTextModal(false)}
          newTextInput={newTextInput}
          setNewTextInput={setNewTextInput}
          newTextColor={newTextColor}
          setNewTextColor={setNewTextColor}
          newTextSize={newTextSize}
          setNewTextSize={setNewTextSize}
          onAdd={addText}
          overlayTexts={overlayTexts}
          onRemoveText={(id) => setOverlayTexts(prev => prev.filter(t => t.id !== id))}
          insets={insets}
        />
        <ProductModal
          visible={showProductModal}
          onClose={() => setShowProductModal(false)}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          productTags={productTags}
          onTag={tagProduct}
          taggableProducts={taggableProducts}
          insets={insets}
        />
      </View>
    );
  }

  // ─── STEP: slide-pick ─────────────────────────────────────────────────────
  if (step === 'slide-pick') {
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('type-select'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Select Photos</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <TouchableOpacity style={s.pickCard} activeOpacity={0.8} onPress={pickPhotos}>
            <View style={[s.pickIconCircle, { backgroundColor: CYAN + '22' }]}>
              <Feather name="upload" size={28} color={CYAN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pickCardTitle}>Upload photos</Text>
              <Text style={s.pickCardSub}>Select one or more from your library</Text>
            </View>
            <Feather name="chevron-right" size={18} color={MUTED} />
          </TouchableOpacity>

          {slidePhotos.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.sectionLabel}>Selected photos ({slidePhotos.length})</Text>
              <Text style={[s.stepSubtitle, { marginBottom: 10 }]}>Drag to reorder (tap to remove)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {slidePhotos.map((photo, idx) => (
                    <View key={photo.id} style={s.slideThumb}>
                      <LinearGradient colors={['#0E2830', '#061420']} style={s.slideGrad}>
                        <Feather name="image" size={20} color={MUTED} />
                        <Text style={s.clipDur}>#{idx + 1}</Text>
                      </LinearGradient>
                      <TouchableOpacity
                        style={s.clipRemove}
                        onPress={() => setSlidePhotos(prev => prev.filter(p => p.id !== photo.id))}
                      >
                        <Feather name="x" size={12} color={FG} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={[s.nextBtn, slidePhotos.length === 0 && s.nextBtnDisabled]}
            activeOpacity={0.85}
            disabled={slidePhotos.length === 0}
            onPress={() => hapticNav(() => setStep('slide-ratio'))}
          >
            <LinearGradient
              colors={slidePhotos.length > 0 ? [GREEN, '#20C060'] : [BORDER, BORDER]}
              style={s.nextBtnGrad}
            >
              <Text style={[s.nextBtnText, slidePhotos.length === 0 && { color: MUTED }]}>Next →</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── STEP: slide-ratio ────────────────────────────────────────────────────
  if (step === 'slide-ratio') {
    const ratios: Array<{ ratio: AspectRatio; label: string; recommended?: boolean; w: number; h: number }> = [
      { ratio: '9:16', label: '9:16 Portrait', recommended: true, w: 54, h: 96 },
      { ratio: '3:4', label: '3:4 Portrait', w: 72, h: 96 },
      { ratio: '1:1', label: '1:1 Square', w: 96, h: 96 },
    ];
    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('slide-pick'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Aspect Ratio</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={[s.infoCard, { marginBottom: 20 }]}>
            <Ionicons name="trending-up" size={14} color={GREEN} style={{ marginRight: 8 }} />
            <Text style={[s.infoCardText, { flex: 1 }]}>9:16 gets the most reach on Thread.</Text>
          </View>
          {ratios.map((r) => {
            const sel = aspectRatio === r.ratio;
            return (
              <TouchableOpacity
                key={r.ratio}
                style={[s.ratioCard, sel && s.ratioCardSel]}
                activeOpacity={0.8}
                onPress={() => { Haptics.selectionAsync(); setAspectRatio(r.ratio); }}
              >
                <View style={[s.ratioPreview, { width: r.w, height: r.h }]} />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={[s.ratioLabel, sel && { color: GREEN }]}>{r.label}</Text>
                  {r.recommended && (
                    <View style={s.recommendedBadge}>
                      <Text style={s.recommendedText}>Recommended</Text>
                    </View>
                  )}
                </View>
                {sel && <Feather name="check-circle" size={20} color={GREEN} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={[s.bottomBar, { paddingBottom: botPad + 8 }]}>
          <TouchableOpacity
            style={s.nextBtn}
            activeOpacity={0.85}
            onPress={() => hapticNav(() => setStep('slide-edit'))}
          >
            <LinearGradient colors={[GREEN, '#20C060']} style={s.nextBtnGrad}>
              <Text style={s.nextBtnText}>Next →</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── STEP: slide-edit ─────────────────────────────────────────────────────
  if (step === 'slide-edit') {
    const transitions: TransitionStyle[] = ['cut', 'fade', 'slide', 'zoom', 'flash', 'blur'];
    const transitionLabels: Record<TransitionStyle, string> = {
      cut: 'Cut', fade: 'Fade', slide: 'Slide', zoom: 'Zoom', flash: 'Flash', blur: 'Blur',
    };

    const previewW = screenWidth - 32;
    let previewH = previewW;
    if (aspectRatio === '9:16') previewH = previewW * (16 / 9);
    else if (aspectRatio === '3:4') previewH = previewW * (4 / 3);
    const previewHClamped = Math.min(previewH, screenHeight * 0.4);

    return (
      <View style={[s.root, { paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('slide-ratio'))} style={s.backBtn}>
            <Feather name="arrow-left" size={22} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Edit Slideshow</Text>
          <TouchableOpacity onPress={() => hapticNav(() => setStep('post-details'))} style={s.doneBtn}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Photo strip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {slidePhotos.map((photo, idx) => (
                <View key={photo.id} style={s.slideThumb}>
                  <LinearGradient colors={['#0E2830', '#061420']} style={s.slideGrad}>
                    <Feather name="image" size={16} color={MUTED} />
                    <Text style={s.clipDur}>#{idx + 1}</Text>
                  </LinearGradient>
                  <TouchableOpacity
                    style={s.clipRemove}
                    onPress={() => setSlidePhotos(prev => prev.filter(p => p.id !== photo.id))}
                  >
                    <Feather name="x" size={12} color={FG} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Preview area */}
          <View style={[s.slidePreviewArea, { height: previewHClamped }]}>
            <LinearGradient colors={['#0E2830', '#061420']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="layers" size={36} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 12 }}>{aspectRatio} Preview</Text>
            </LinearGradient>
          </View>

          {/* Transition */}
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>Transition</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {transitions.map((tr) => (
                <TouchableOpacity
                  key={tr}
                  style={[s.transitionPill, transition === tr && s.transitionPillActive]}
                  onPress={() => { Haptics.selectionAsync(); setTransition(tr); }}
                >
                  <Text style={[s.transitionPillText, transition === tr && { color: '#0A0B0A' }]}>
                    {transitionLabels[tr]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Slide duration */}
          <Text style={s.sectionLabel}>Slide Duration</Text>
          <View style={s.stepperRow}>
            <TouchableOpacity
              style={s.stepperBtn}
              onPress={() => setSlideDuration(d => Math.max(1, d - 1))}
            >
              <Feather name="minus" size={18} color={FG} />
            </TouchableOpacity>
            <Text style={s.stepperValue}>{slideDuration}s</Text>
            <TouchableOpacity
              style={s.stepperBtn}
              onPress={() => setSlideDuration(d => Math.min(10, d + 1))}
            >
              <Feather name="plus" size={18} color={FG} />
            </TouchableOpacity>
          </View>

          {/* Sound */}
          <TouchableOpacity style={[s.outlineBtn, { marginTop: 16 }]} onPress={() => setShowSoundModal(true)} activeOpacity={0.8}>
            <Feather name="music" size={16} color={FG} style={{ marginRight: 8 }} />
            <Text style={s.outlineBtnText}>Add Sound</Text>
          </TouchableOpacity>

          {/* Text overlay */}
          <TouchableOpacity style={[s.outlineBtn, { marginTop: 10 }]} onPress={() => setShowTextModal(true)} activeOpacity={0.8}>
            <Feather name="type" size={16} color={FG} style={{ marginRight: 8 }} />
            <Text style={s.outlineBtnText}>Add Text Overlay</Text>
          </TouchableOpacity>

          {/* Product tag */}
          <TouchableOpacity style={[s.outlineBtn, { marginTop: 10 }]} onPress={() => setShowProductModal(true)} activeOpacity={0.8}>
            <Feather name="tag" size={16} color={FG} style={{ marginRight: 8 }} />
            <Text style={s.outlineBtnText}>Tag Product</Text>
          </TouchableOpacity>

          {/* Selected sound */}
          {selectedSound && (
            <View style={[s.soundStrip, { marginTop: 12 }]}>
              <Feather name="music" size={14} color={GREEN} />
              <Text style={s.soundStripText} numberOfLines={1}>{selectedSound.soundTitle} – {selectedSound.artist}</Text>
              <TouchableOpacity onPress={() => setSelectedSound(null)}>
                <Feather name="x" size={16} color={MUTED} />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        <SoundModal
          visible={showSoundModal}
          onClose={() => setShowSoundModal(false)}
          soundTab={soundTab}
          setSoundTab={setSoundTab}
          soundSearch={soundSearch}
          setSoundSearch={setSoundSearch}
          onUse={useSound}
          insets={insets}
        />
        <TextModal
          visible={showTextModal}
          onClose={() => setShowTextModal(false)}
          newTextInput={newTextInput}
          setNewTextInput={setNewTextInput}
          newTextColor={newTextColor}
          setNewTextColor={setNewTextColor}
          newTextSize={newTextSize}
          setNewTextSize={setNewTextSize}
          onAdd={addText}
          overlayTexts={overlayTexts}
          onRemoveText={(id) => setOverlayTexts(prev => prev.filter(t => t.id !== id))}
          insets={insets}
        />
        <ProductModal
          visible={showProductModal}
          onClose={() => setShowProductModal(false)}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          productTags={productTags}
          onTag={tagProduct}
          taggableProducts={taggableProducts}
          insets={insets}
        />
      </View>
    );
  }

  // ─── STEP: post-details ───────────────────────────────────────────────────
  if (step === 'post-details') {
    const typeLabel: Record<string, string> = {
      video: 'Video', slideshow: 'Slideshow', announcement: 'Product Announcement',
      countdown: 'Drop Announcement', behind_scenes: 'Behind the Scenes', story: 'Story',
    };
    const typeColor: Record<string, string> = {
      video: PURPLE, slideshow: CYAN, announcement: GREEN,
      countdown: ORANGE, behind_scenes: '#EC4899', story: BLUE,
    };
    const ct = contentType ?? 'video';

    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[s.root, { paddingTop: topPad }]}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => hapticNav(() => setStep(editStepBack()))}
              style={s.backBtn}
            >
              <Feather name="arrow-left" size={22} color={FG} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Post Details</Text>
            <View style={{ width: 38 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            {/* Mini preview */}
            <View style={{ position: 'relative' }}>
              <View style={s.miniPreviewCard}>
                <LinearGradient
                  colors={[typeColor[ct] + '33', typeColor[ct] + '11']}
                  style={s.miniPreviewGrad}
                >
                  <Feather name="file" size={28} color={typeColor[ct]} />
                </LinearGradient>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.miniPreviewType}>{typeLabel[ct]}</Text>
                  <Text style={s.miniPreviewSub}>
                    {ct === 'video' ? `${videoClips.length} clip(s)` : ct === 'slideshow' ? `${slidePhotos.length} photo(s)` : 'Ready to publish'}
                  </Text>
                </View>
                <View style={[s.typeBadge, { backgroundColor: typeColor[ct] + '22', borderColor: typeColor[ct] + '44' }]}>
                  <Text style={[s.typeBadgeText, { color: typeColor[ct] }]}>{typeLabel[ct]}</Text>
                </View>
              </View>
              {productTags.length > 0 && (
                <View style={{ position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 6, gap: 4 }}>
                  <Feather name="shopping-bag" size={12} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'System' }}>{productTags[0].productName}</Text>
                </View>
              )}
            </View>

            {/* Caption */}
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
            <Text style={[s.charCount]}>{caption.length} / 2200</Text>

            {/* Hashtags */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Hashtags</Text>
            <TextInput
              style={s.hashtagInput}
              value={hashtagInput}
              onChangeText={setHashtagInput}
              placeholder="#hashtag"
              placeholderTextColor={MUTED}
              returnKeyType="done"
              onSubmitEditing={() => { if (hashtagInput.trim().length > 1) addHashtag(hashtagInput); }}
              blurOnSubmit={false}
            />
            {/* Suggested */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {SUGGESTED_HASHTAGS.map((h) => (
                  <TouchableOpacity
                    key={h.tag}
                    style={s.suggestedChip}
                    onPress={() => { if (!hashtags.find(hh => hh.tag === h.tag)) setHashtags(prev => [...prev, h]); }}
                  >
                    {h.trending && <Feather name="trending-up" size={10} color={GREEN} style={{ marginRight: 3 }} />}
                    <Text style={s.suggestedChipText}>{h.tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {/* Selected hashtags */}
            {hashtags.length > 0 && (
              <View style={s.hashtagWrap}>
                {hashtags.map((h) => (
                  <TouchableOpacity key={h.tag} style={s.hashtagChip} onPress={() => removeHashtag(h.tag)}>
                    <Text style={s.hashtagChipText}>{h.tag}</Text>
                    <Feather name="x" size={11} color={GREEN} style={{ marginLeft: 4 }} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Tagged products */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Tagged Products</Text>
            {productTags.length > 0 && (
              <View style={s.hashtagWrap}>
                {productTags.map((pt) => (
                  <View key={pt.productId} style={[s.hashtagChip, { backgroundColor: GREEN + '11', borderColor: GREEN + '33' }]}>
                    <Text style={[s.hashtagChipText, { color: FG }]}>{pt.productName}</Text>
                    <TouchableOpacity onPress={() => setProductTags(prev => prev.filter(t => t.productId !== pt.productId))}>
                      <Feather name="x" size={11} color={MUTED} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity style={[s.outlineBtn, { marginTop: 8 }]} onPress={() => setShowProductModal(true)} activeOpacity={0.8}>
              <Feather name="tag" size={14} color={FG} style={{ marginRight: 6 }} />
              <Text style={s.outlineBtnText}>Tag products</Text>
            </TouchableOpacity>

            {/* Location */}
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Location</Text>
            <View style={s.locationRow}>
              <Feather name="map-pin" size={16} color={MUTED} style={{ marginRight: 8 }} />
              <TextInput
                style={[s.locationInput]}
                value={location}
                onChangeText={setLocation}
                placeholder="Add location"
                placeholderTextColor={MUTED}
              />
            </View>

            {/* Visibility toggles */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>Settings</Text>
            {[
              { label: 'Allow comments', key: 'allowComments' as keyof PostVisibility },
              { label: 'Allow reposts', key: 'allowReposts' as keyof PostVisibility },
              { label: 'Show like count', key: 'showLikeCount' as keyof PostVisibility },
            ].map(({ label, key }) => (
              <View key={key} style={s.toggleRow}>
                <Text style={s.toggleLabel}>{label}</Text>
                <Switch
                  value={visibility[key] as boolean}
                  onValueChange={(v) => setVisibility(prev => ({ ...prev, [key]: v }))}
                  thumbColor={(visibility[key] as boolean) ? GREEN : MUTED}
                  trackColor={{ false: BORDER, true: GREEN + '44' }}
                />
              </View>
            ))}

            {/* Schedule */}
            <Text style={[s.sectionLabel, { marginTop: 20 }]}>Schedule</Text>
            <View style={s.scheduleRow}>
              <TouchableOpacity
                style={[s.schedulePill, scheduleMode === 'now' && s.schedulePillActive]}
                onPress={() => setScheduleMode('now')}
              >
                {scheduleMode === 'now' && <Feather name="check" size={12} color={GREEN} style={{ marginRight: 4 }} />}
                <Text style={[s.schedulePillText, scheduleMode === 'now' && { color: GREEN }]}>Publish now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.schedulePill, scheduleMode === 'schedule' && s.schedulePillActive]}
                onPress={() => setScheduleMode('schedule')}
              >
                {scheduleMode === 'schedule' && <Feather name="check" size={12} color={GREEN} style={{ marginRight: 4 }} />}
                <Text style={[s.schedulePillText, scheduleMode === 'schedule' && { color: GREEN }]}>Schedule</Text>
              </TouchableOpacity>
            </View>
            {scheduleMode === 'schedule' && (
              <TextInput
                style={[s.hashtagInput, { marginTop: 10 }]}
                value={scheduledDateInput}
                onChangeText={(v) => { setScheduledDateInput(v); setScheduledAt(v); }}
                placeholder="YYYY-MM-DD HH:MM"
                placeholderTextColor={MUTED}
              />
            )}

            {/* Action buttons */}
            <TouchableOpacity
              style={[s.outlineBtn, { marginTop: 24 }]}
              activeOpacity={0.8}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                try {
                  await createSellerPost({
                    contentType: contentType ?? 'video',
                    caption,
                    hashtags: hashtags.map(h => h.tag),
                    productTagIds: productTags.map(p => p.productId),
                    isDraft: true,
                  });
                  Alert.alert('Draft saved', 'Your draft has been saved.', [{ text: 'OK', onPress: () => router.back() }]);
                } catch {
                  Alert.alert('Error', 'Could not save draft. Please try again.');
                }
              }}
            >
              <Feather name="save" size={16} color={FG} style={{ marginRight: 8 }} />
              <Text style={s.outlineBtnText}>Save as draft</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 10 }}
              activeOpacity={0.85}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isPublishing) return;
                setIsPublishing(true);
                setStep('publishing');
                try {
                  await createSellerPost({
                    contentType: contentType ?? 'video',
                    caption,
                    hashtags: hashtags.map(h => h.tag),
                    productTagIds: productTags.map(p => p.productId),
                    isDraft: false,
                    scheduledAt: scheduleMode === 'schedule' ? scheduledAt : null,
                  });
                  setStep('done');
                } catch {
                  setStep('post-details');
                  Alert.alert('Publish failed', 'Something went wrong. Your post was not saved. Please try again.');
                } finally {
                  setIsPublishing(false);
                }
              }}
            >
              <LinearGradient colors={[GREEN, '#20C060']} style={s.publishBtn}>
                <Feather name="send" size={16} color="#0A0B0A" style={{ marginRight: 8 }} />
                <Text style={s.publishBtnText}>Publish now</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>

          <ProductModal
            visible={showProductModal}
            onClose={() => setShowProductModal(false)}
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            productTags={productTags}
            onTag={tagProduct}
            taggableProducts={taggableProducts}
            insets={insets}
          />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── STEP: publishing ─────────────────────────────────────────────────────
  if (step === 'publishing') {
    return (
      <View style={[s.root, s.fullCenter, { paddingTop: topPad, paddingBottom: botPad }]}>
        <Animated.View style={[s.publishCircle, { transform: [{ scale: pulseAnim }] }]}>
          <LinearGradient colors={[GREEN + '44', GREEN + '22']} style={s.publishCircleGrad}>
            <Feather name="upload-cloud" size={36} color={GREEN} />
          </LinearGradient>
        </Animated.View>
        <Text style={[s.doneTitle, { marginTop: 24 }]}>Publishing...</Text>
        <Text style={s.doneSub}>Your content is being prepared for Thread.</Text>
        <ActivityIndicator color={GREEN} style={{ marginTop: 24 }} />
      </View>
    );
  }

  // ─── STEP: done ───────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <View style={[s.root, s.fullCenter, { paddingTop: topPad, paddingBottom: botPad }]}>
        <LinearGradient colors={[GREEN + '44', GREEN + '22']} style={s.doneCircle}>
          <Feather name="check" size={44} color={GREEN} />
        </LinearGradient>
        <Text style={s.doneTitle}>Posted!</Text>
        <Text style={s.doneSub}>Your post has been saved and will appear on your profile.</Text>
        <TouchableOpacity
          style={s.doneBtn2}
          activeOpacity={0.85}
          onPress={() => hapticNav(() => router.replace('/(tabs)/profile' as never))}
        >
          <LinearGradient colors={[GREEN, '#20C060']} style={s.doneBtnGrad}>
            <Text style={s.doneBtnText2}>View Profile</Text>
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
  visible: boolean;
  onClose: () => void;
  soundTab: 'trending' | 'saved' | 'recent' | 'original' | 'royalty_free';
  setSoundTab: (t: 'trending' | 'saved' | 'recent' | 'original' | 'royalty_free') => void;
  soundSearch: string;
  setSoundSearch: (s: string) => void;
  onUse: (sound: Sound) => void;
  insets: { top: number; bottom: number };
}
function SoundModal({ visible, onClose, soundTab, setSoundTab, soundSearch, setSoundSearch, onUse, insets }: SoundModalProps) {
  const tabs: Array<{ id: 'trending' | 'saved' | 'recent' | 'original' | 'royalty_free'; label: string }> = [
    { id: 'trending', label: 'Trending' },
    { id: 'saved', label: 'Saved' },
    { id: 'recent', label: 'Recent' },
    { id: 'original', label: 'Original' },
    { id: 'royalty_free', label: 'Free' },
  ];
  const filtered = DEMO_SOUNDS.filter(s =>
    (soundTab === 'trending' ? s.isTrending || s.category === 'trending' : s.category === soundTab) &&
    (soundSearch === '' || s.title.toLowerCase().includes(soundSearch.toLowerCase()) || s.artist.toLowerCase().includes(soundSearch.toLowerCase()))
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'}
      onRequestClose={onClose}
    >
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Sounds</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        <View style={sm.searchWrap}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput
            style={sm.searchInput}
            value={soundSearch}
            onChangeText={setSoundSearch}
            placeholder="Search sounds..."
            placeholderTextColor={MUTED}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
            {tabs.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[sm.tabPill, soundTab === t.id && sm.tabPillActive]}
                onPress={() => setSoundTab(t.id)}
              >
                <Text style={[sm.tabText, soundTab === t.id && { color: GREEN }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Feather name="music" size={28} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 10, fontFamily: 'Inter_400Regular' }}>No sounds found</Text>
            </View>
          ) : (
            filtered.map((sound) => (
              <View key={sound.id} style={sm.soundRow}>
                <View style={sm.soundIcon}>
                  <Feather name="music" size={16} color={PURPLE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sm.soundTitle}>{sound.title}</Text>
                  <Text style={sm.soundArtist}>{sound.artist}</Text>
                </View>
                <Text style={sm.soundDur}>{sound.duration}s</Text>
                <TouchableOpacity
                  style={sm.useBtn}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUse(sound); }}
                >
                  <Text style={sm.useBtnText}>Use</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={sm.disclaimer}>
            <Text style={sm.disclaimerText}>⚠ All sounds are royalty-free demo tracks. No licensed commercial music.</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Text Overlay Modal ───────────────────────────────────────────────────────
interface TextModalProps {
  visible: boolean;
  onClose: () => void;
  newTextInput: string;
  setNewTextInput: (v: string) => void;
  newTextColor: string;
  setNewTextColor: (v: string) => void;
  newTextSize: number;
  setNewTextSize: (v: number) => void;
  onAdd: () => void;
  overlayTexts: Array<{ id: string; text: string; color: string; fontSize: number }>;
  onRemoveText: (id: string) => void;
  insets: { top: number; bottom: number };
}
function TextModal({ visible, onClose, newTextInput, setNewTextInput, newTextColor, setNewTextColor, newTextSize, setNewTextSize, onAdd, overlayTexts, onRemoveText, insets }: TextModalProps) {
  const COLOR_SWATCHES = ['#FFFFFF', '#000000', '#F87171', '#39FF88', '#3B82F6', '#FBBF24', '#8B5CF6'];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'}
      onRequestClose={onClose}
    >
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Add Text</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <TextInput
            style={sm.textInput}
            value={newTextInput}
            onChangeText={setNewTextInput}
            placeholder="Enter text..."
            placeholderTextColor={MUTED}
          />
          <Text style={sm.modalLabel}>Font Size</Text>
          <View style={sm.stepperRow}>
            <TouchableOpacity style={sm.stepperBtn} onPress={() => setNewTextSize(Math.max(12, newTextSize - 2))}>
              <Feather name="minus" size={16} color={FG} />
            </TouchableOpacity>
            <Text style={sm.stepperVal}>{newTextSize}px</Text>
            <TouchableOpacity style={sm.stepperBtn} onPress={() => setNewTextSize(Math.min(64, newTextSize + 2))}>
              <Feather name="plus" size={16} color={FG} />
            </TouchableOpacity>
          </View>
          <Text style={sm.modalLabel}>Color</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {COLOR_SWATCHES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[sm.swatch, { backgroundColor: c }, newTextColor === c && sm.swatchActive]}
                onPress={() => setNewTextColor(c)}
              />
            ))}
          </View>
          <TouchableOpacity style={{ marginTop: 8 }} onPress={onAdd} activeOpacity={0.85}>
            <LinearGradient colors={[GREEN, '#20C060']} style={sm.addTextBtn}>
              <Text style={sm.addTextBtnText}>Add Text</Text>
            </LinearGradient>
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

// ─── Product Tag Modal ────────────────────────────────────────────────────────
interface ProductModalProps {
  visible: boolean;
  onClose: () => void;
  productSearch: string;
  setProductSearch: (v: string) => void;
  productTags: PostProductTag[];
  onTag: (p: Product) => void;
  taggableProducts: Product[];
  insets: { top: number; bottom: number };
}
function ProductModal({ visible, onClose, productSearch, setProductSearch, productTags, onTag, taggableProducts, insets }: ProductModalProps) {
  const filtered = taggableProducts.filter(p =>
    productSearch === '' || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );
  const statusColor = (st: string) => st === 'active' ? GREEN : st === 'scheduled' ? ORANGE : MUTED;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'android' ? 'fullScreen' : 'pageSheet'}
      onRequestClose={onClose}
    >
      <View style={[sm.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={sm.header}>
          <Text style={sm.title}>Tag Products</Text>
          <TouchableOpacity onPress={onClose} style={sm.closeBtn}>
            <Feather name="x" size={20} color={FG} />
          </TouchableOpacity>
        </View>
        {/* Tagged chips */}
        {productTags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {productTags.map((pt) => {
                const prod = taggableProducts.find(p => p.id === pt.productId);
                return (
                  <View key={pt.productId} style={sm.taggedChip}>
                    <Text style={sm.taggedChipText}>{pt.productName}</Text>
                    <TouchableOpacity onPress={() => prod && onTag(prod)}>
                      <Feather name="x" size={11} color={GREEN} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}
        <View style={[sm.searchWrap, { marginTop: 8 }]}>
          <Feather name="search" size={14} color={MUTED} style={{ marginRight: 8 }} />
          <TextInput
            style={sm.searchInput}
            value={productSearch}
            onChangeText={setProductSearch}
            placeholder="Search products..."
            placeholderTextColor={MUTED}
          />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          {filtered.map((p) => {
            const isTagged = productTags.some(t => t.productId === p.id);
            const coverMedia = p.media.find(m => m.isCover) ?? p.media[0];
            return (
              <View key={p.id} style={sm.productRow}>
                <View style={[sm.productSwatch, { backgroundColor: coverMedia ? MUTED : BORDER }]} />
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
                  <Text style={[sm.tagBtnText, isTagged && { color: '#0A0B0A' }]}>{isTagged ? 'Remove' : 'Tag'}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={onClose} activeOpacity={0.85}>
            <LinearGradient colors={[GREEN, '#20C060']} style={sm.addTextBtn}>
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
  root:       { flex: 1, backgroundColor: BG },
  fullCenter: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  backBtn:  { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  doneBtn:  { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: GREEN + '22', borderRadius: 8, borderWidth: 1, borderColor: GREEN + '44' },
  doneBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },

  // type-select
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  typeCard: {
    width: '47%', backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', paddingVertical: 24, paddingHorizontal: 8, gap: 12,
  },
  typeIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG, textAlign: 'center' },

  // video/slide pick
  pickCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    padding: 18,
  },
  pickIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  pickCardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  pickCardSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },

  clipThumb: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  clipGrad:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  clipDur:   { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED },
  clipRemove:{
    position: 'absolute', top: 4, right: 4,
    backgroundColor: '#00000088', borderRadius: 10,
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },

  slideThumb: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  slideGrad:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },

  bottomBar: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
  nextBtn:   { borderRadius: 14, overflow: 'hidden' },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnGrad: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  nextBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  // video-duration
  stepSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 12 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: CYAN + '11', borderRadius: 10, borderWidth: 1, borderColor: CYAN + '33', padding: 12 },
  infoCardText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  durationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  durationCard: {
    width: '46%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', paddingVertical: 28, gap: 6,
  },
  durationCardSel: { backgroundColor: GREEN + '11', borderColor: GREEN },
  durationNum:   { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG },
  durationLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  // video-edit
  pauseOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000055',
  },
  durChip: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 4 },
  durChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  trimHandle: {
    position: 'absolute', top: -8, width: 16, height: 20,
    backgroundColor: GREEN, borderRadius: 3,
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 14, gap: 10 },
  controlBtn: { width: 38, height: 38, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  speedPill: { backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  speedPillActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  speedPillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  toolCard: { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, gap: 6 },
  toolLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  soundStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, backgroundColor: GREEN + '11', borderRadius: 10, borderWidth: 1, borderColor: GREEN + '33', paddingHorizontal: 12, paddingVertical: 8 },
  soundStripText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: GREEN },
  beatSyncRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, paddingVertical: 8 },
  beatSyncLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },

  // slide-ratio
  ratioCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: CARD,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 12,
  },
  ratioCardSel: { backgroundColor: GREEN + '11', borderColor: GREEN },
  ratioPreview: { backgroundColor: BORDER, borderRadius: 6 },
  ratioLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  recommendedBadge: { backgroundColor: GREEN + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 4 },
  recommendedText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: GREEN },

  // slide-edit
  slidePreviewArea: { marginHorizontal: 16, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: BORDER },
  transitionPill: { backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 8 },
  transitionPillActive: { backgroundColor: GREEN, borderColor: GREEN },
  transitionPillText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepperBtn: { width: 38, height: 38, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG, minWidth: 40, textAlign: 'center' },

  // post-details
  miniPreviewCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14 },
  miniPreviewGrad: { width: 52, height: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  miniPreviewType: { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  miniPreviewSub:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  typeBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  typeBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  captionInput: {
    backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    color: FG, fontFamily: 'Inter_400Regular', fontSize: 14,
    padding: 12, minHeight: 100, textAlignVertical: 'top',
  },
  charCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'right', marginTop: 4 },

  hashtagInput: {
    backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    color: FG, fontFamily: 'Inter_400Regular', fontSize: 14,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  suggestedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 5 },
  suggestedChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  hashtagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  hashtagChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: GREEN + '11', borderRadius: 14, borderWidth: 1, borderColor: GREEN + '33', paddingHorizontal: 10, paddingVertical: 5 },
  hashtagChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: GREEN },

  locationRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10 },
  locationInput: { flex: 1, color: FG, fontFamily: 'Inter_400Regular', fontSize: 14 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  toggleLabel: { fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },

  scheduleRow: { flexDirection: 'row', gap: 10 },
  schedulePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 8 },
  schedulePillActive: { backgroundColor: GREEN + '11', borderColor: GREEN + '44' },
  schedulePillText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },

  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  outlineBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },

  publishBtn: { borderRadius: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  publishBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  // publishing
  publishCircle: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden' },
  publishCircleGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // done
  doneCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  doneTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 8 },
  doneSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', marginBottom: 4, paddingHorizontal: 32 },
  doneBtn2: { marginTop: 32, borderRadius: 14, overflow: 'hidden', width: 200 },
  doneBtnGrad: { paddingVertical: 14, alignItems: 'center' },
  doneBtnText2: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
});

// ─── Modal Styles ─────────────────────────────────────────────────────────────
const sm = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  title:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER },

  searchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, marginBottom: 8, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, color: FG, fontFamily: 'Inter_400Regular', fontSize: 14 },

  tabPill: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 6 },
  tabPillActive: { backgroundColor: GREEN + '22', borderColor: GREEN + '44' },
  tabText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },

  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  soundIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE + '22', alignItems: 'center', justifyContent: 'center' },
  soundTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  soundArtist: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  soundDur: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  useBtn: { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  useBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },

  disclaimer: { marginTop: 20, padding: 12, backgroundColor: ORANGE + '11', borderRadius: 10, borderWidth: 1, borderColor: ORANGE + '33' },
  disclaimerText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: ORANGE },

  // text modal
  textInput: { backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: 'Inter_400Regular', fontSize: 16, padding: 12, marginBottom: 16 },
  modalLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  stepperBtn: { width: 36, height: 36, backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  stepperVal: { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG, minWidth: 50, textAlign: 'center' },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchActive: { borderWidth: 3, borderColor: GREEN },
  addTextBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  addTextBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  overlayChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  overlayChipText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  // product modal
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  productSwatch: { width: 24, height: 24, borderRadius: 6 },
  productName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  productPrice: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  tagBtn: { backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 6 },
  tagBtnActive: { backgroundColor: GREEN, borderColor: GREEN },
  tagBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },
  taggedChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: GREEN + '22', borderRadius: 14, borderWidth: 1, borderColor: GREEN + '44', paddingHorizontal: 10, paddingVertical: 5 },
  taggedChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: GREEN },
});

import React, { useCallback, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  Animated, View, Text, ScrollView, Pressable, TextInput,
  StyleSheet, Dimensions, Alert, Image, FlatList, Modal, PanResponder,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useUser } from '@clerk/expo';
import {
  BG, SURFACE, CARD, BORDER,
  FG, MUTED, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { createStory, MY_COLOR } from '@/services/socialService';
import { useApi } from '@/lib/api';
import type { StoryMedia, StoryOverlay, StoryPrivacySettings } from '@/services/socialTypes';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { getTaggableProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { PressableScale, HapticSwitch } from '@/components/BrandthreadUI';
import { IconButton, Button } from '@/components/ui';
import { hapticLight, hapticToggle, hapticPrimaryAction, hapticSuccessAction } from '@/lib/haptics';

const STICKER_EMOJI = ['🔥', '✨', '❤️', '😂', '🎉', '👀', '💯', '⭐️'];

/** A single draggable overlay (text or sticker) placed on the story canvas. */
function DraggableOverlay({ overlay, canvasSize, onMove, onRemove }: {
  overlay: StoryOverlay;
  canvasSize: { width: number; height: number };
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
}) {
  const pan = useRef(new Animated.ValueXY({ x: overlay.x, y: overlay.y })).current;
  const lastPos = useRef({ x: overlay.x, y: overlay.y });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        pan.setOffset({ x: lastPos.current.x, y: lastPos.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // @ts-ignore — _value is internal but stable, same pattern as TextOverlayEditor's OverlayChip
        const rawX = (pan.x as any)._value as number;
        // @ts-ignore
        const rawY = (pan.y as any)._value as number;
        const x = Math.max(0, Math.min(canvasSize.width - 20, rawX));
        const y = Math.max(0, Math.min(canvasSize.height - 20, rawY));
        pan.setValue({ x, y });
        lastPos.current = { x, y };
        onMove(overlay.id, x, y);
      },
    }),
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      testID={`story-overlay-${overlay.id}`}
      style={[storyOverlayStyles.chip, { transform: pan.getTranslateTransform() }]}
    >
      <Pressable
        onLongPress={() => { hapticLight(); onRemove(overlay.id); }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        accessibilityRole="button"
        accessibilityLabel={`${overlay.text}, long-press to remove`}
      >
        <Text style={{ color: overlay.color ?? '#FFF', fontSize: overlay.size ?? 28, fontFamily: FONT.bold }}>
          {overlay.text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const storyOverlayStyles = StyleSheet.create({
  chip: { position: 'absolute', top: 0, left: 0 },
});

/** A muted, looping preview frame for the selected video clip, instead of a bare play icon. */
function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; p.play(); });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

const { width: W } = Dimensions.get('window');
const CANVAS_H = Math.min(W * 1.4, 400);

const BG_COLORS = ['#1a1a2e', '#0d1117', '#1a0d1a', '#0d1a2e', '#1a1400', '#2e0d0d'];
type MediaType = 'photo' | 'video' | 'text';
type Visibility = 'public' | 'friends';

const TYPE_TABS: { label: string; value: MediaType; icon: string }[] = [
  { label: 'Photo', value: 'photo', icon: 'image' },
  { label: 'Video', value: 'video', icon: 'video' },
  { label: 'Text',  value: 'text',  icon: 'type'  },
];

export default function BuyerStoryCreate() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_DIM = colors.accent, CYAN = theme.secondary;
  const BORDER_ACTIVE = `${theme.accent}73`;
  const TEXT_COLORS = ['#FFFFFF', '#000000', PURPLE, CYAN, '#F59E0B', '#10B981'];
  const styles = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useUser();
  const myName = user?.fullName || user?.firstName || user?.username || 'You';
  const myHandle = user?.username ? `@${user.username}` : '';
  const myInitials = myName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';
  const api     = useApi();
  const params  = useLocalSearchParams<{ accountType?: string }>();

  const [type, setType] = useState<MediaType>('text');
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [textContent, setTextContent] = useState('');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [privacyVis, setPrivacyVis] = useState<Visibility>('public');
  const [allowReplies, setAllowReplies] = useState(true);
  const [isPosting, setIsPosting] = useState(false);

  // Photo — supports multi-select for multi-slide story reel
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  // Video — single clip, capped at 15s
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);

  // Text overlay + stickers, applied to the first (or only) slide.
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const [textDraftColor, setTextDraftColor] = useState('#FFFFFF');
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);

  // Product tag — sellers only.
  const isSeller = params.accountType === 'seller';
  const [taggedProduct, setTaggedProduct] = useState<{ id: string; name: string } | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [taggableProducts, setTaggableProducts] = useState<Product[]>([]);

  const canvasSize = { width: W - SP.md * 2, height: CANVAS_H };

  const addTextOverlay = () => {
    setTextDraft('');
    setTextDraftColor('#FFFFFF');
    setTextModalVisible(true);
  };

  const commitTextOverlay = () => {
    const text = textDraft.trim();
    if (text) {
      setOverlays(prev => [...prev, {
        id: `ov_${Date.now()}`,
        type: 'text',
        x: canvasSize.width / 2 - 40,
        y: canvasSize.height / 2 - 20,
        text,
        color: textDraftColor,
        size: 28,
      }]);
    }
    setTextModalVisible(false);
  };

  const addSticker = (emoji: string) => {
    setOverlays(prev => [...prev, {
      id: `ov_${Date.now()}`,
      type: 'text',
      x: canvasSize.width / 2 - 24,
      y: canvasSize.height / 2 - 24,
      text: emoji,
      size: 44,
    }]);
    setStickerPickerOpen(false);
  };

  const moveOverlay = useCallback((id: string, x: number, y: number) => {
    setOverlays(prev => prev.map(o => (o.id === id ? { ...o, x, y } : o)));
  }, []);
  const removeOverlay = useCallback((id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
  }, []);

  const openProductPicker = async () => {
    try {
      const products = await getTaggableProducts();
      setTaggableProducts(products);
    } catch {
      setTaggableProducts([]);
    }
    setProductPickerOpen(true);
  };

  const hasMedia =
    type === 'photo' ? photoUris.length > 0 :
    type === 'video' ? !!videoUri :
    textContent.trim().length > 0;

  const isShareDisabled = isPosting || !hasMedia;

  // ── Pickers ───────────────────────────────────────────────────────────────

  async function pickPhotos() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to add photos to your story.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.9,
    });
    if (!result.canceled && result.assets.length) {
      setPhotoUris(result.assets.map(a => a.uri));
    }
  }

  async function pickVideo() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to add video to your story.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 15,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setVideoUri(asset.uri);
      setVideoDuration(Math.min((asset as any).duration ?? 15, 15));
    }
  }

  // ── Post ──────────────────────────────────────────────────────────────────

  const doShare = useCallback(async () => {
    if (isShareDisabled) return;
    setIsPosting(true);
    try {
      let media: StoryMedia[];

      if (type === 'photo') {
        // Each selected photo becomes one slide in a story reel; overlays
        // and a product tag are authored on the first slide only.
        media = photoUris.map((uri, i) => ({
          id:              `sm_${Date.now()}_${i}`,
          type:            'photo' as const,
          backgroundColor: '#000',
          imageUri:        uri,
          duration:        5,
          ...(i === 0 ? {
            overlays: overlays.length ? overlays : undefined,
            productTagId: taggedProduct?.id,
            productTagName: taggedProduct?.name,
          } : {}),
        }));
      } else if (type === 'video') {
        media = [{
          id:              `sm_${Date.now()}`,
          type:            'video' as const,
          backgroundColor: '#000',
          imageUri:        videoUri!,
          duration:        Math.max(videoDuration, 3),
          overlays:        overlays.length ? overlays : undefined,
          productTagId:    taggedProduct?.id,
          productTagName:  taggedProduct?.name,
        }];
      } else {
        media = [{
          id:              `sm_${Date.now()}`,
          type:            'text' as const,
          backgroundColor: bgColor,
          textContent,
          textColor,
          duration:        5,
          overlays:        overlays.length ? overlays : undefined,
        }];
      }

      const privacy: StoryPrivacySettings = {
        visibility:        privacyVis,
        replyPermission:   allowReplies ? 'everyone' : 'off',
        hiddenFromUserIds: [],
        closeFriendsOnly:  false,
      };

      // Save locally (source of truth for this device)
      await createStory({ media, privacy, repliesDisabled: !allowReplies });

      // Persist to server (fire-and-forget)
      api.social.createStory({
        authorName:        myName,
        authorHandle:      myHandle,
        authorInitials:    myInitials,
        authorColor:       MY_COLOR,
        authorAccountType: (params.accountType as any) ?? 'buyer',
        media,
        repliesDisabled:   !allowReplies,
        privacy:           { visibility: privacyVis, replyPermission: allowReplies ? 'everyone' : 'off' },
      }).catch(() => {});

      goBackOr(router);
    } catch {
      Alert.alert("Couldn't share your story", 'Try again.');
    } finally {
      setIsPosting(false);
    }
  }, [isShareDisabled, type, bgColor, textContent, textColor, privacyVis, allowReplies,
      photoUris, videoUri, videoDuration, params.accountType, overlays, taggedProduct]);

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* HEADER */}
      <View style={styles.header}>
        <IconButton name="x" variant="plain" color={ON_DARK} accessibilityLabel="Close" onPress={() => goBackOr(router)} />
        <Text style={styles.headerTitle}>New story</Text>
        <PressableScale
          onPress={() => { hapticPrimaryAction(); doShare(); }}
          disabled={isShareDisabled}
          style={{ opacity: isShareDisabled ? 0.4 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={isPosting ? 'Posting story' : 'Share story'}
        >
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.shareBtn}
          >
            <Text style={[styles.shareBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{isPosting ? 'Posting…' : 'Share'}</Text>
          </LinearGradient>
        </PressableScale>
      </View>

      {/* TYPE TABS */}
      <View style={styles.typeTabs}>
        {TYPE_TABS.map(tab => {
          const active = tab.value === type;
          return (
            <PressableScale
              key={tab.value}
              style={[
                styles.typeTab,
                active
                  ? { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }
                  : { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
              ]}
              onPress={() => { hapticToggle(); setType(tab.value); }}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label} story`}
              accessibilityState={{ selected: active }}
            >
              <Feather name={tab.icon as any} size={ICON.sm} color={active ? PURPLE : 'rgba(255,255,255,0.6)'} />
              <Text style={[styles.typeTabLabel, { color: active ? PURPLE : 'rgba(255,255,255,0.6)' }]}>
                {tab.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
      >
        {/* CANVAS */}
        <View style={styles.canvasWrapper}>
          <View style={[styles.canvas, { height: CANVAS_H }]}>

            {/* ── TEXT ── */}
            {type === 'text' && (
              <View style={[styles.canvasFill, { backgroundColor: bgColor }]}>
                <TextInput
                  style={[styles.textInput, { color: textColor }]}
                  value={textContent}
                  onChangeText={setTextContent}
                  placeholder="Type something…"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  textAlign="center"
                />
              </View>
            )}

            {/* ── PHOTO ── */}
            {type === 'photo' && (
              photoUris.length > 0 ? (
                <View style={styles.canvasFill}>
                  <Image source={{ uri: photoUris[0] }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  {photoUris.length > 1 && (
                    <View style={styles.multiSlideChip}>
                      <Feather name="layers" size={11} color="#FFF" />
                      <Text style={styles.multiSlideText}>{photoUris.length} slides</Text>
                    </View>
                  )}
                  <Pressable
                    style={({ pressed }) => [styles.changeBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { hapticLight(); pickPhotos(); }}
                  >
                    <Text style={styles.changeBtnText}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.canvasFill, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => { hapticLight(); pickPhotos(); }}
                >
                  <View style={styles.placeholder}>
                    <Feather name="image" size={48} color="rgba(255,255,255,0.35)" />
                    <Text style={styles.placeholderTitle}>Tap to choose photos</Text>
                    <Text style={styles.placeholderSub}>Select up to 10 — each becomes a slide</Text>
                  </View>
                </Pressable>
              )
            )}

            {/* ── VIDEO ── */}
            {type === 'video' && (
              videoUri ? (
                <View style={styles.canvasFill}>
                  <VideoPreview uri={videoUri} />
                  <View style={styles.videoDurChip}>
                    <Feather name="video" size={11} color="#FFF" />
                    <Text style={styles.videoDurChipText}>
                      {videoDuration > 0 ? `${Math.round(videoDuration)}s` : 'Video'}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.changeBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { hapticLight(); pickVideo(); }}
                  >
                    <Text style={styles.changeBtnText}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.canvasFill, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => { hapticLight(); pickVideo(); }}
                >
                  <View style={styles.placeholder}>
                    <Feather name="video" size={48} color="rgba(255,255,255,0.35)" />
                    <Text style={styles.placeholderTitle}>Tap to choose a video</Text>
                    <Text style={styles.placeholderSub}>Clips are capped at 15 seconds</Text>
                  </View>
                </Pressable>
              )
            )}

            {/* ── TEXT OVERLAYS + STICKERS ── */}
            {overlays.map(overlay => (
              <DraggableOverlay
                key={overlay.id}
                overlay={overlay}
                canvasSize={canvasSize}
                onMove={moveOverlay}
                onRemove={removeOverlay}
              />
            ))}
          </View>
        </View>

        {/* OVERLAY TOOLBAR — text, stickers, product tag (sellers) */}
        <View style={styles.overlayToolbar}>
          <Pressable
            style={({ pressed }) => [styles.toolbarBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => { hapticLight(); addTextOverlay(); }}
            testID="story-add-text"
            accessibilityRole="button"
            accessibilityLabel="Add text"
          >
            <Feather name="type" size={ICON.sm} color={ON_DARK} />
            <Text style={styles.toolbarBtnText}>Text</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.toolbarBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => { hapticLight(); setStickerPickerOpen(v => !v); }}
            testID="story-add-sticker"
            accessibilityRole="button"
            accessibilityLabel="Add sticker"
          >
            <Feather name="smile" size={ICON.sm} color={ON_DARK} />
            <Text style={styles.toolbarBtnText}>Sticker</Text>
          </Pressable>
          {isSeller && (
            <Pressable
              style={({ pressed }) => [styles.toolbarBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => { hapticLight(); openProductPicker(); }}
              testID="story-tag-product"
              accessibilityRole="button"
              accessibilityLabel={taggedProduct ? `Tagged product: ${taggedProduct.name}` : 'Tag a product'}
            >
              <Feather name="shopping-bag" size={ICON.sm} color={ON_DARK} />
              <Text style={styles.toolbarBtnText} numberOfLines={1}>{taggedProduct ? taggedProduct.name : 'Tag product'}</Text>
              {taggedProduct && (
                <Pressable
                  onPress={() => { hapticLight(); setTaggedProduct(null); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove tagged product"
                >
                  <Feather name="x" size={ICON.xs} color={ON_DARK} />
                </Pressable>
              )}
            </Pressable>
          )}
        </View>

        {stickerPickerOpen && (
          <View style={styles.stickerRow}>
            {STICKER_EMOJI.map(emoji => (
              <PressableScale
                key={emoji}
                style={styles.stickerBtn}
                onPress={() => { hapticToggle(); addSticker(emoji); }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${emoji} sticker`}
              >
                <Text style={styles.stickerEmoji}>{emoji}</Text>
              </PressableScale>
            ))}
          </View>
        )}

        {/* PHOTO STRIP — thumbnail row when multi-photo selected */}
        {type === 'photo' && photoUris.length > 1 && (
          <View style={styles.photoStrip}>
            <FlatList
              horizontal
              data={photoUris}
              keyExtractor={(_, i) => String(i)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: SP.xs, paddingHorizontal: SP.md }}
              renderItem={({ item, index }) => (
                <View style={styles.photoThumb}>
                  <Image source={{ uri: item }} style={styles.photoThumbImg} resizeMode="cover" />
                  <View style={styles.thumbNumBadge}>
                    <Text style={styles.thumbNumText}>{index + 1}</Text>
                  </View>
                </View>
              )}
            />
          </View>
        )}

        {/* ADVANCED EDITOR LINK — when photo/video is ready */}
        {type !== 'text' && hasMedia && (
          <Pressable
            style={({ pressed }) => [styles.advancedBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => {
              hapticLight();
              router.push({
                pathname: '/create-post',
                params: { accountType: params.accountType ?? 'buyer' },
              } as any);
            }}
            accessibilityRole="button"
          >
            <Feather name="sliders" size={ICON.sm} color={PURPLE} />
            <Text style={styles.advancedBtnText}>Open advanced editor — add text, links, GIFs</Text>
          </Pressable>
        )}

        {/* TEXT CONTROLS */}
        {type === 'text' && (
          <View style={styles.controlsPanel}>
            <Text style={styles.controlLabel}>Background</Text>
            <View style={styles.colorRow}>
              {BG_COLORS.map(c => (
                <PressableScale
                  key={c}
                  style={[styles.colorCircle, { backgroundColor: c }, bgColor === c && styles.colorCircleActive]}
                  onPress={() => { hapticToggle(); setBgColor(c); }}
                  accessibilityRole="button"
                  accessibilityLabel="Background color"
                  accessibilityState={{ selected: bgColor === c }}
                />
              ))}
            </View>
            <Text style={[styles.controlLabel, { marginTop: SP.md }]}>Text color</Text>
            <View style={styles.colorRow}>
              {TEXT_COLORS.map(c => (
                <PressableScale
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    textColor === c && styles.colorCircleActive,
                    c === '#000000' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
                  ]}
                  onPress={() => { hapticToggle(); setTextColor(c); }}
                  accessibilityRole="button"
                  accessibilityLabel="Text color"
                  accessibilityState={{ selected: textColor === c }}
                />
              ))}
            </View>
          </View>
        )}

        {/* PRIVACY */}
        <View style={styles.privacySection}>
          <View style={styles.privacyCard}>
            <PressableScale
              style={styles.privacyRow}
              onPress={() => {
                hapticLight();
                Alert.alert('Audience', '', [
                  { text: 'Everyone',      onPress: () => setPrivacyVis('public')  },
                  { text: 'Friends only',  onPress: () => setPrivacyVis('friends') },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Who can see this story"
            >
              <Feather name={privacyVis === 'public' ? 'globe' : 'users'} size={ICON.md} color={PURPLE} />
              <Text style={styles.privacyLabel}>Who can see</Text>
              <Text style={styles.privacyValue}>{privacyVis === 'public' ? 'Everyone' : 'Friends only'}</Text>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </PressableScale>

            <View style={styles.privacyDivider} />

            <View style={styles.privacyRow}>
              <Feather name="message-circle" size={ICON.md} color={PURPLE} />
              <Text style={[styles.privacyLabel, { flex: 1 }]}>Replies</Text>
              <HapticSwitch
                value={allowReplies}
                onValueChange={setAllowReplies}
                trackColor={{ false: BORDER, true: PURPLE }}
                thumbColor={ON_DARK}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* TEXT OVERLAY MODAL */}
      <Modal visible={textModalVisible} transparent animationType="fade" onRequestClose={() => setTextModalVisible(false)}>
        <View style={styles.overlayModalBackdrop}>
          <View style={styles.overlayModalCard}>
            <Text style={styles.controlLabel}>Add text</Text>
            <TextInput
              style={styles.overlayTextInput}
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder="Say something…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
            />
            <View style={[styles.colorRow, { marginTop: SP.sm }]}>
              {TEXT_COLORS.map(c => (
                <PressableScale
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    textDraftColor === c && styles.colorCircleActive,
                    c === '#000000' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
                  ]}
                  onPress={() => { hapticToggle(); setTextDraftColor(c); }}
                  accessibilityRole="button"
                  accessibilityLabel="Text color"
                  accessibilityState={{ selected: textDraftColor === c }}
                />
              ))}
            </View>
            <View style={styles.overlayModalActions}>
              <Button label="Cancel" variant="secondary" size="small" onPress={() => setTextModalVisible(false)} style={{ flex: 1 }} />
              <Button label="Add" variant="primary" size="small" onPress={() => { hapticPrimaryAction(); commitTextOverlay(); }} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* PRODUCT TAG PICKER (sellers) */}
      <Modal visible={productPickerOpen} transparent animationType="slide" onRequestClose={() => setProductPickerOpen(false)}>
        <Pressable
          style={styles.overlayModalBackdrop}
          onPress={() => setProductPickerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={[styles.productSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <Text style={styles.controlLabel}>Tag a product</Text>
          <FlatList
            data={taggableProducts}
            keyExtractor={p => p.id}
            ListEmptyComponent={<Text style={styles.placeholderSub}>No products to tag yet.</Text>}
            renderItem={({ item }) => (
              <PressableScale
                style={styles.productRow}
                onPress={() => { hapticLight(); setTaggedProduct({ id: item.id, name: item.name }); setProductPickerOpen(false); }}
                accessibilityRole="button"
                accessibilityLabel={`Tag ${item.name}`}
              >
                <Text style={styles.privacyLabel}>{item.name}</Text>
                <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
              </PressableScale>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_DIM = theme.accentDim, BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
  },
  headerTitle: {
    flex: 1,
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    textAlign: 'center',
  },
  shareBtn: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
  },
  shareBtnText: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  typeTabs: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  typeTab: {
    flex: 1,
    height: 36,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    borderWidth: 1,
  },
  typeTabLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  canvasWrapper: {
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  canvas: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  canvasFill: {
    flex: 1,
    backgroundColor: SURFACE,
  },
  textInput: {
    flex: 1,
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    textAlign: 'center',
    padding: SP.xl,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SP.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: RADIUS.lg,
  },
  placeholderTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FS.base,
    fontFamily: FONT.medium,
  },
  placeholderSub: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    textAlign: 'center',
    paddingHorizontal: SP.lg,
  },
  multiSlideChip: {
    position: 'absolute',
    top: SP.sm,
    right: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
  },
  multiSlideText: {
    color: '#FFF',
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  changeBtn: {
    position: 'absolute',
    bottom: SP.sm,
    right: SP.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  changeBtnText: {
    color: '#FFF',
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  videoDurChip: {
    position: 'absolute',
    top: SP.sm,
    right: SP.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
  },
  videoDurChipText: {
    color: '#FFF',
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  photoStrip: {
    marginTop: SP.sm,
    paddingVertical: SP.xs,
  },
  photoThumb: {
    width: 60,
    height: 80,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  photoThumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbNumBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbNumText: {
    color: '#FFF',
    fontSize: FS.xs,
    fontFamily: FONT.bold,
  },
  advancedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    paddingVertical: SP.sm,
    paddingHorizontal: SP.md,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: `${PURPLE}59`,
  },
  advancedBtnText: {
    color: PURPLE,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  controlsPanel: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
  },
  controlLabel: {
    color: ON_DARK,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginBottom: SP.sm,
  },
  colorRow: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorCircleActive: {
    borderWidth: 2,
    borderColor: PURPLE,
  },
  privacySection: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
  },
  privacyCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    gap: SP.sm,
  },
  privacyLabel: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.base,
    flex: 1,
  },
  privacyValue: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginRight: SP.xs,
  },
  privacyDivider: {
    height: 1,
    backgroundColor: BORDER,
  },
  overlayToolbar: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
  },
  toolbarBtnText: {
    color: ON_DARK,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  stickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  stickerBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickerEmoji: {
    fontSize: FS.xl,
  },
  overlayModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayModalCard: {
    width: W - SP.xl * 2,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  overlayTextInput: {
    color: ON_DARK,
    fontSize: FS.md,
    fontFamily: FONT.medium,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: SP.sm,
  },
  overlayModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SP.sm,
    marginTop: SP.md,
  },
  productSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    maxHeight: '60%',
    padding: SP.md,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  });
};

import React, { useCallback, useRef, useState } from 'react';
import {
  Animated, View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, Alert, Switch, Image, FlatList, Modal, PanResponder,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
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
      <TouchableOpacity onLongPress={() => onRemove(overlay.id)} activeOpacity={0.85}>
        <Text style={{ color: overlay.color ?? '#FFF', fontSize: overlay.size ?? 28, fontFamily: FONT.bold }}>
          {overlay.text}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const storyOverlayStyles = StyleSheet.create({
  chip: { position: 'absolute', top: 0, left: 0 },
});

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

      router.back();
    } catch {
      Alert.alert('Error', 'Failed to post story. Please try again.');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Story</Text>
        <TouchableOpacity
          onPress={doShare}
          disabled={isShareDisabled}
          style={{ opacity: isShareDisabled ? 0.4 : 1 }}
        >
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.shareBtn}
          >
            <Text style={[styles.shareBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>{isPosting ? 'Posting…' : 'Share'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* TYPE TABS */}
      <View style={styles.typeTabs}>
        {TYPE_TABS.map(tab => {
          const active = tab.value === type;
          return (
            <TouchableOpacity
              key={tab.value}
              style={[
                styles.typeTab,
                active
                  ? { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }
                  : { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
              ]}
              onPress={() => setType(tab.value)}
            >
              <Feather name={tab.icon as any} size={ICON.sm} color={active ? PURPLE : 'rgba(255,255,255,0.6)'} />
              <Text style={[styles.typeTabLabel, { color: active ? PURPLE : 'rgba(255,255,255,0.6)' }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
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
                  placeholder="Tap to type..."
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
                  <TouchableOpacity style={styles.changeBtn} onPress={pickPhotos}>
                    <Text style={styles.changeBtnText}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.canvasFill} activeOpacity={0.8} onPress={pickPhotos}>
                  <View style={styles.placeholder}>
                    <Feather name="image" size={48} color="rgba(255,255,255,0.35)" />
                    <Text style={styles.placeholderTitle}>Tap to choose photos</Text>
                    <Text style={styles.placeholderSub}>Select up to 10 — each becomes a slide</Text>
                  </View>
                </TouchableOpacity>
              )
            )}

            {/* ── VIDEO ── */}
            {type === 'video' && (
              videoUri ? (
                <View style={styles.canvasFill}>
                  <View style={styles.videoReadyBg}>
                    <Feather name="play-circle" size={56} color="rgba(255,255,255,0.8)" />
                    <Text style={styles.videoDurText}>
                      {videoDuration > 0 ? `${Math.round(videoDuration)}s` : 'Video'} · ready to post
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={pickVideo}>
                    <Text style={styles.changeBtnText}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.canvasFill} activeOpacity={0.8} onPress={pickVideo}>
                  <View style={styles.placeholder}>
                    <Feather name="video" size={48} color="rgba(255,255,255,0.35)" />
                    <Text style={styles.placeholderTitle}>Tap to choose a video</Text>
                    <Text style={styles.placeholderSub}>Clips are capped at 15 seconds</Text>
                  </View>
                </TouchableOpacity>
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
          <TouchableOpacity style={styles.toolbarBtn} onPress={addTextOverlay} testID="story-add-text">
            <Feather name="type" size={ICON.sm} color={ON_DARK} />
            <Text style={styles.toolbarBtnText}>Text</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toolbarBtn}
            onPress={() => setStickerPickerOpen(v => !v)}
            testID="story-add-sticker"
          >
            <Feather name="smile" size={ICON.sm} color={ON_DARK} />
            <Text style={styles.toolbarBtnText}>Sticker</Text>
          </TouchableOpacity>
          {isSeller && (
            <TouchableOpacity style={styles.toolbarBtn} onPress={openProductPicker} testID="story-tag-product">
              <Feather name="shopping-bag" size={ICON.sm} color={ON_DARK} />
              <Text style={styles.toolbarBtnText}>{taggedProduct ? taggedProduct.name : 'Tag product'}</Text>
              {taggedProduct && (
                <TouchableOpacity onPress={() => setTaggedProduct(null)} hitSlop={8}>
                  <Feather name="x" size={ICON.xs} color={ON_DARK} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
        </View>

        {stickerPickerOpen && (
          <View style={styles.stickerRow}>
            {STICKER_EMOJI.map(emoji => (
              <TouchableOpacity key={emoji} style={styles.stickerBtn} onPress={() => addSticker(emoji)}>
                <Text style={styles.stickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
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
          <TouchableOpacity
            style={styles.advancedBtn}
            onPress={() =>
              router.push({
                pathname: '/create-post',
                params: { accountType: params.accountType ?? 'buyer' },
              } as any)
            }
          >
            <Feather name="sliders" size={ICON.sm} color={PURPLE} />
            <Text style={styles.advancedBtnText}>Open advanced editor — add text, links, GIFs</Text>
          </TouchableOpacity>
        )}

        {/* TEXT CONTROLS */}
        {type === 'text' && (
          <View style={styles.controlsPanel}>
            <Text style={styles.controlLabel}>Background</Text>
            <View style={styles.colorRow}>
              {BG_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorCircle, { backgroundColor: c }, bgColor === c && styles.colorCircleActive]}
                  onPress={() => setBgColor(c)}
                />
              ))}
            </View>
            <Text style={[styles.controlLabel, { marginTop: SP.md }]}>Text color</Text>
            <View style={styles.colorRow}>
              {TEXT_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    textColor === c && styles.colorCircleActive,
                    c === '#000000' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
                  ]}
                  onPress={() => setTextColor(c)}
                />
              ))}
            </View>
          </View>
        )}

        {/* PRIVACY */}
        <View style={styles.privacySection}>
          <View style={styles.privacyCard}>
            <TouchableOpacity
              style={styles.privacyRow}
              onPress={() =>
                Alert.alert('Audience', '', [
                  { text: 'Everyone',      onPress: () => setPrivacyVis('public')  },
                  { text: 'Friends only',  onPress: () => setPrivacyVis('friends') },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
            >
              <Feather name={privacyVis === 'public' ? 'globe' : 'users'} size={ICON.md} color={PURPLE} />
              <Text style={styles.privacyLabel}>Who can see</Text>
              <Text style={styles.privacyValue}>{privacyVis === 'public' ? 'Everyone' : 'Friends only'}</Text>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>

            <View style={styles.privacyDivider} />

            <View style={styles.privacyRow}>
              <Feather name="message-circle" size={ICON.md} color={PURPLE} />
              <Text style={[styles.privacyLabel, { flex: 1 }]}>Replies</Text>
              <Switch
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
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    textDraftColor === c && styles.colorCircleActive,
                    c === '#000000' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
                  ]}
                  onPress={() => setTextDraftColor(c)}
                />
              ))}
            </View>
            <View style={styles.overlayModalActions}>
              <TouchableOpacity onPress={() => setTextModalVisible(false)} style={styles.overlayModalCancel}>
                <Text style={styles.overlayModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={commitTextOverlay} style={[styles.overlayModalDone, { backgroundColor: PURPLE }]}>
                <Text style={styles.overlayModalDoneText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PRODUCT TAG PICKER (sellers) */}
      <Modal visible={productPickerOpen} transparent animationType="slide" onRequestClose={() => setProductPickerOpen(false)}>
        <TouchableOpacity style={styles.overlayModalBackdrop} activeOpacity={1} onPress={() => setProductPickerOpen(false)} />
        <View style={[styles.productSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <Text style={styles.controlLabel}>Tag a product</Text>
          <FlatList
            data={taggableProducts}
            keyExtractor={p => p.id}
            ListEmptyComponent={<Text style={styles.placeholderSub}>No products to tag yet.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.productRow}
                onPress={() => { setTaggedProduct({ id: item.id, name: item.name }); setProductPickerOpen(false); }}
              >
                <Text style={styles.privacyLabel}>{item.name}</Text>
                <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
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
  closeBtn: {
    width: 36, height: 36,
    justifyContent: 'center', alignItems: 'center',
  },
  closeText: {
    color: ON_DARK,
    fontSize: FS.xxl,
    fontFamily: FONT.bold,
    lineHeight: FS.xxl + 4,
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
  videoReadyBg: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SP.sm,
  },
  videoDurText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FS.sm,
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
  overlayModalCancel: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  overlayModalCancelText: {
    color: MUTED,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  overlayModalDone: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
  },
  overlayModalDoneText: {
    color: ON_DARK,
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
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

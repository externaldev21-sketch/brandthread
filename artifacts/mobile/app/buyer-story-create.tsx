import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, Alert, Switch, Image, FlatList,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  BG, SURFACE, CARD, BORDER,
  FG, MUTED, ON_DARK,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { createStory, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_HANDLE } from '@/services/socialService';
import { useApi } from '@/lib/api';
import type { StoryMedia, StoryPrivacySettings } from '@/services/socialTypes';
import { useColors } from '@/hooks/useColors';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';

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
        // Each selected photo becomes one slide in a story reel
        media = photoUris.map((uri, i) => ({
          id:              `sm_${Date.now()}_${i}`,
          type:            'photo' as const,
          backgroundColor: '#000',
          imageUri:        uri,
          duration:        5,
        }));
      } else if (type === 'video') {
        media = [{
          id:              `sm_${Date.now()}`,
          type:            'video' as const,
          backgroundColor: '#000',
          imageUri:        videoUri!,
          duration:        Math.max(videoDuration, 3),
        }];
      } else {
        media = [{
          id:              `sm_${Date.now()}`,
          type:            'text' as const,
          backgroundColor: bgColor,
          textContent,
          textColor,
          duration:        5,
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
        authorName:        MY_USER_ID,
        authorHandle:      MY_HANDLE,
        authorInitials:    MY_INITIALS,
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
      photoUris, videoUri, videoDuration, params.accountType]);

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
          </View>
        </View>

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
    fontSize: 9,
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
  });
};
